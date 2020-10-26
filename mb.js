#!/usr/bin/env node

/**
 * Example/demo for Control Solutions Advanced Control MODBUS interface package
 *
 * Run the demo from the command line.  The port settings in the config.json
 * file will be used to connect to the ACN device and execute the command.
 * If defined, the MODBUS_PORT environment variable will override the
 * port identified in the config.json file.
 *
 */
'use strict';

var CONFIG_DEFAULTS = {
  "port": {
    "name": "use_--port_to_select_port",
    "options": {
      "baudRate": 115200
    }
  },
  "websocket": {
    "url": "http://127.0.0.1:8080",
    "reconnection": true,
    "reconnectionAttempts": 3,
    "reconnectionDelay": 1000,
    "reconnectionDelayMax": 5000,
    "timeout": 5000
  },
  "can": {
    "rate": 250000,
    "myid": 254
  },
  "canUsbComm": {
    "baudRate": 480800,
    "j1939": {
      "preferredAddress": 254,
    }
  },
  "master": {
    "transport": {
      "type": "rtu",
      "eofTimeout": 40,
      "connection": {
        "type": "serial",
        "socket": "Replace with an instance of io()"
      }
    },
    "suppressTransactionErrors": true,
    "retryOnException": false,
    "maxConcurrentRequests": 2,
    "defaultUnit": 1,
    "defaultMaxRetries": 0,
    "defaultTimeout": 2000
  }
};

// get the config folder location - depends on Operating System
// darwin = MAC
// Windows: HOMEPATH environment variable
// Linux (Debian): HOME environment variable
let CONFIG_FOLDER = (process.env.APPDATA) ||
  (process.platform === 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOMEPATH || process.env.HOME);

let CONFIG_FILE = CONFIG_FOLDER + '/.cs-mb-cli.json';


// get application path
var path = require('path');

// misc utilities
var util = require('util');

// console text formatting
var chalk = require('chalk');

// command-line options will be available in the args variable
var args = require('minimist')(process.argv.slice(2));

let pjson = require('./package.json');

var config;

// read config file unless forced to use defaults, or can't read config file
if (args.default) {
  config = CONFIG_DEFAULTS;
} else {
  try {
    config = require(CONFIG_FILE);
  } catch (e) {
    config = CONFIG_DEFAULTS;
  }
}

// Keep track of mode for output purposes (boolean)
var isAscii = (config.master.transport.type === 'ascii');

// Module which manages the serial port
var SerialPortFactory = require('serialport');

// logging helper module
var winston = require('winston');

// Load the object that handles communication to the device
var ModbusPort = require('@csllc/cs-modbus');

// the instance of the modbus master
var master;

// Buffer utilities
var buffers = require('h5.buffers');

// use environment variable for port name if specified
config.port.name = args.port || process.env.MODBUS_PORT || config.port.name;

// override slave id if necessary
config.master.defaultUnit = args.slave ||
  args.unit ||
  process.env.MODBUS_SLAVE ||
  config.master.defaultUnit;

// override baud if necessary
config.port.options.baudRate = args.baudrate || args.baud || args.baudRate ||
  process.env.MODBUS_BAUDRATE ||
  config.port.options.baudRate;


// override transport if necessary
config.master.transport.type = args.transport ||
  process.env.MODBUS_TRANSPORT ||
  config.master.transport.type;

// override transport if necessary
config.master.transport.connection.type = args.connection ||
  process.env.MODBUS_CONNECTION ||
  config.master.transport.connection.type;

// override CANBUS rate if necessary
config.can.rate = args.canrate ||
  process.env.MODBUS_CANRATE ||
  config.can.rate;

// override canbus ID if necessary
config.can.myid = args.canid ||
  process.env.MODBUS_CANID ||
  config.can.myid;


// if the user included the --save option, write the
// actual configuration back to the config.json file to be
// the defaults for next time
if (args.save) {
  var fs = require('fs');

  console.info(chalk.green('Writing configuration file: \r' + CONFIG_FILE + '\r'));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));

}

// If the address is a MAC address, set up for Bluetooth operation,
// overriding config.json properties as needed
var macRE = /^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/i;

if (!args.l && config.port.name && macRE.test(config.port.name)) {
  config.master.transport.type = 'ip';
  config.master.transport.connection.type = 'ble';
} else {
  // assume it's a serial port.  We could test this but remember serial
  // ports have different name formats depending on operating system

  // don't open serial port until we explicitly call the open method
  config.port.options.autoOpen = false;

}


// Keep track of when the action started, for timing purposes
var startTime;

/**
 * Clean up and exit the application.
 *
 * @param  {[type]} code [description]
 * @return {[type]}      [description]
 */
function exit(code) {
  try {
    master.destroy();
  } catch (e) {}
  process.exit(code);
}

/**
 * If error, print it, otherwise print the result as an object dump
 * @param  {err}
 * @return null
 */
function output(err, response) {

  if (err) {
    //console.log( chalk.red( err.message ) );
    exit(1);
  } else {

    // output the result in the requested format
    if ('csv' === args.out) {

      var timemark = new Date().getTime() - startTime;
      console.info(timemark + ',' + response.toBuffer().join(','));

    }

    // if caller requested a loop, do the action again
    if (args.loop) {
      setImmediate(doAction);
    } else {
      exit(0);
    }
  }
}

/**
 * Parses a string into a number with bounds check
 *
 * String can be decimal, or if it starts with 0x
 * it is interpreted as hex
 *
 * @param  {[string]} s       string to parse
 * @param  {[number]} default if string can't be parsed
 * @return {[number]}         the parsed number or the default
 */
function parseNumber(s, def) {
  var number;

  if ('undefined' === typeof(s)) {
    return def;
  }

  if (s.toString().substring(0, 1) === '0x') {
    number = parseInt(s.substring(2), 16);
  } else {
    number = parseInt(s);
  }
  return number;

}

// parse string to integer, either 0xhh or ddd format
function parseValue(str) {

  if (str.toString().substring(0, 1) === '0x') {
    return parseInt(str.substring(2), 16);
  } else {
    return parseInt(str);
  }
}

/**
 * Convert an array of args to an array of numbers
 *
 * Parses 0x as hex numbers, else decimal
 * @param  {[array]} args  string array
 * @param  {[number]} start offset in args to start parsing
 * @return {[array]}       array of numbers
 */
function argsToByteBuf(args, start) {

  var values = [];

  for (var i = start; i < args.length; i++) {
    var number;

    if (args[i].toString().indexOf(':') > -1) {
      // a repeated value
      var tokens = args[i].split(':');

      var value = parseValue(tokens[0]);
      var count = parseValue(tokens[1]);

      if (value >= 0 && value <= 255 && count > 0 && count < 65536) {
        var arr = new Array(count).fill(value);

        values = values.concat(arr);
      }
    } else {
      number = parseValue(args[i]);
      if (number < 0 || number > 255) {
        console.error(chalk.red('Invalid data value: ' + args[i]));
        exit(1);
      }
      values.push(number);
    }

  }

  return Buffer.from(values);

}

/**
 * Convert an array of args to an buffer of 16-bit words
 *
 * Parses 0x as hex numbers, else decimal
 * @param  {[array]} args  string array
 * @param  {[number]} start offset in args to start parsing
 * @return {[Buffer]}       Buffer of words
 */
function argsToWordBuf(args, start) {
  var builder = new buffers.BufferBuilder();

  for (var i = start; i < args.length; i++) {
    var number;

    if (args[i].toString().substring(0, 1) === '0x') {
      number = parseInt(args[i].substring(2), 16);
    } else {
      number = parseInt(args[i]);
    }

    if (number < 0 || number > 65535) {
      console.error(chalk.red('Invalid data value: ' + args[i]));
      exit(1);
    }
    builder.pushUInt16(number);
  }

  return builder.toBuffer();

}


if (args.h) {
  console.info('\r--------MODBUS Utility: ' + pjson.version + '----------');
  console.info('Reads or writes from an MODBUS device\r');
  console.info('See config.json for connection configuration.\r');
  console.info('\rCommand format:\r');
  console.info(path.basename(__filename, '.js') +
    '[-h -v] action [type] [...]\r');
  console.info('    action: read/write/command\r');
  console.info('    type: identifies what to read/write/command/generic\r');
  console.info('\r    Read types:\r');
  console.info(chalk.bold('        coil') + ' [start] [quantity]');
  console.info(chalk.bold('        discrete') + ' [start] [quantity]');
  console.info(chalk.bold('        holding') + ' [start] [quantity]');
  console.info(chalk.bold('        input') + ' [start] [quantity]');
  console.info(chalk.bold('        slave'));
  console.info(chalk.bold('        fifo') + ' [id] [max]');
  console.info(chalk.bold('        object') + ' [id]');
  console.info(chalk.bold('        memory') +
    ' [address] [length]');

  console.info('\r    Write types:\r');
  console.info(chalk.bold('        coil') +
    ' [start] [quantity] value1 value2...');
  console.info(chalk.bold('        holding') +
    ' [start] [quantity] value1 value2...');
  console.info(chalk.bold('        fifo') + ' [id] value1 value2...');
  console.info(chalk.bold('        object') + ' [id] value1 value2...');
  console.info(chalk.bold('        memory') +
    ' [address] value1 value2...');

  console.info('\r    Command types:\r');
  console.info(chalk.bold('        [id]') + ' [value1] [value2] ...');

  console.info('\r    Generic types (allows any function code to be sent):\r');
  console.info(chalk.bold('        [function]') + ' [value1] [value2] ...');

  console.info(chalk.underline('\rOptions\r'));
  console.info('    -h          This help output\r');
  console.info('    -l          List all ports on the system\r');
  console.info('    -v          Verbose output (for debugging)\r');
  console.info('    --save      Save configuration for future\r');
  console.info('    --show      Show configuration\r');
  console.info('    --default   Use default configuration rather than saved\r');
  console.info('    --loop      Repeat command until CTRL-C\r');
  console.info('    --log       Write info to specified logfile\r');
  console.info('    --out       Output type (eg csv)\r');
  console.info('    --port      Specify serial port to use\r');
  console.info('    --baud      Specify serial baud rate\r');
  console.info('    --canrate   Specify CANBUS baud rate');
  console.info('    --canid     Specify (my) CANBUS node ID');
  console.info('    --slave     ' +
    'Specify MODBUS slave ID to communicate with\r');
  console.info('    --transport ' +
    'Specify type of transport to use (ascii/rtu/tunnel/ip/socketcand/j1939\r');
  console.info('    --connection ' +
    'Specify type of connection to use (serial/tcp/udp/generic/can-usb-com\r');

  console.info(chalk.underline('\rResult\r'));
  console.info('Return value is 0 if successful\r');
  console.info('Output may be directed to a file\r');
  console.info('    e.g. ' +
    chalk.dim('mb read object 1 >> myConfig.json') + '\r');
  console.info(chalk.underline('Examples\r'));
  console.info('mb read holding 0 3 (read 3 registers from 0)\r');
  console.info('mb write holding 0 0x100 32 23  ' +
    '(writes register 0, 1, and 2)\r');
  console.info('mb read slave  (retrieve device info)\r');
  console.info('mb read slave --port=COM1 --baud=19200 ' +
    '--slave=12 --save (save defaults)\r');
  console.info('mb read object 3 --loop --out=csv' +
    ' (keep reading object 3 and print in CSV)\r');
  console.info('mb read holding 0x100 2 --loop --out=csv' +
    ' --log=debug.log (keep reading object 3 and print in CSV)\r');

  process.exit(0);
}


// Once the port is connected, do whatever action was requested
function doAction() {

  var address;
  var quantity;
  var id;
  var max;
  var values;

  // Now do the action that was requested
  switch (action) {

    case 'read':
      // Validate what we are supposed to get
      var type = args._[1] || 'unknown';

      switch (type) {

        case 'coil':
          address = args._[2] || 0;
          quantity = args._[3] || 1;
          master.readCoils(address, quantity, output);
          break;

        case 'discrete':
          address = args._[2] || 0;
          quantity = args._[3] || 1;
          master.readDiscreteInputs(address, quantity, output);
          break;

        case 'holding':
          address = args._[2] || 0;
          quantity = args._[3] || 1;
          master.readHoldingRegisters(address, quantity, output);
          break;

        case 'input':
          address = args._[2] || 0;
          quantity = args._[3] || 1;
          master.readInputRegisters(address, quantity, output);
          break;

        case 'slave':
          master.reportSlaveId(output);
          break;

        case 'fifo':
          id = args._[2] || 0;
          max = args._[3] || 250;
          master.readFifo8(id, max, output);
          break;

        case 'object':
          id = args._[2] || 0;
          master.readObject(id, output);
          break;

        case 'memory':
          {

            address = parseNumber(args._[2], 0);
            var length = parseNumber(args._[3], 1);

            master.readMemory(address, length, output);
            break;
          }

        default:
          console.error(chalk.red('Trying to read unknown item ' + type));
          exit(1);
          break;
      }

      break;

    case 'write':
      // Validate what we are supposed to set
      type = args._[1] || 'unknown';

      switch (type) {
        case 'coil':
          address = args._[2] || 0;
          values = args._[3] || 1;
          master.writeSingleCoil(address, values, output);
          break;

        case 'holding':
          {
            address = args._[2] || 0;
            values = argsToWordBuf(args._, 3);

            if (values.length < 2) {
              console.error(chalk.red('No values specified '));
              exit(1);
            } else {
              master.writeMultipleRegisters(address, values, output);
            }
            break;
          }

        case 'fifo':
          id = args._[2] || 0;
          values = args._[3] || 0;
          master.writeFifo8(id, [values], output);
          break;

        case 'object':
          var id = args._[2] || 0;
          values = argsToByteBuf(args._, 3);

          master.writeObject(id, values, output);
          break;

        case 'memory':
          {
            address = parseNumber(args._[2], 0);
            values = argsToByteBuf(args._, 3);

            master.writeMemory(address, values, output);
            break;
          }

        default:
          console.error(chalk.red('Trying to write unknown item ' + type));
          exit(1);
          break;

      }

      break;

    case 'command':
      {
        // Validate what we are supposed to set
        if (args.length < 2) {
          console.error(chalk.red('Must specify command id ' + type));
          exit(1);
        }
        var buf = argsToByteBuf(args._, 2);

        master.command(args._[1], buf, output);
        break;
      }

    case 'generic':
      {
        // Validate what we are supposed to set
        if (args.length < 2) {
          console.error(chalk.red('Must specify function code ' + type));
          exit(1);
        }
        var buf = argsToByteBuf(args._, 2);

        master.sendGeneric(args._[1], buf, output);
        break;
      }

    default:
      console.error(chalk.red('Unknown action: ' + action));
      exit(1);
      break;
  }
}

// Check for the list ports option
if (args.l) {

  if (config.master.transport.connection.type === 'ble') {

    var BleControllerFactory = require('@csllc/cs-mb-ble');

    port = new BleControllerFactory();

    if (args.v) {
      port.on('scanStart', function() { serialLog.info('[connection#scanning]'); });
      port.on('scanStop', function() { serialLog.info('[connection#stopped]'); });
      port.on('warning', function(w) { serialLog.info('[connection#warning]', w); });
    }

    // Wait for the bluetooth hardware to become ready
    port.once('stateChange', function(state) {

      if (state === 'poweredOn') {

        console.log('Scanning for peripherals (CTRL-C to stop)');

        // Listen for the first device found
        port.on('discover', function(peripheral) {
          console.log(peripheral.advertisement.localName, ': ', peripheral.address);
        });

        // start looking for bluetooth devices
        port.startScanning();

      }

    });
  } else if (config.master.transport.connection.type === 'serial' || config.master.transport.connection.type === 'can-usb-com') {
    // Retrieve a list of all ports detected on the system
    SerialPortFactory.list(function(err, ports) {

      if (err) {
        console.error(err);
      }

      if (ports) {
        // ports is now an array of port descriptions.
        ports.forEach(function(port) {

          // print each port description
          console.log(port.comName +
            ' : ' + port.pnpId + ' : ' + port.manufacturer);

        });
      }

      process.exit(0);

    });
  } else if (config.master.transport.connection.type === 'can') {
    let CanBus = require('@csllc/cs-canbus-universal');

    let Can = new CanBus();
    Can.list()
      .then((ports) => {
        console.log(ports);
        ports.forEach((port) => {
          console.log(port.id);
        });
      });
  }

} else if (args.show) {
  console.log(util.inspect(config));
} else {

  // Check the action argument for validity
  var action = args._[0];

  if (['read', 'write', 'command', 'generic'].indexOf(action) < 0) {
    console.error(chalk.red('Unknown Action ' + action + ' Requested'));
    exit(1);
  }

  let consoleFormat = winston.format.combine(
    winston.format.colorize(),
    //winston.format.timestamp(),
    //winston.format.align(),
    //  winston.format.simple()
    winston.format.splat(),
    winston.format.printf(info => `${info.level}: ${info.message}`)
  );


  var serialLog = winston.createLogger({
    level: (args.v && !args.out) ? 'silly' : 'info',
    //format: winston.format.json(),
    defaultMeta: { service: 'serial' },
    transports: [

      new winston.transports.Console({
        level: 'info',
        format: consoleFormat,
        silent: !(args.v)
      }),
    ]
  });

  // Logs to a file if the --log option is used
  if (args.log > '') {
    serialLog.add(new winston.transports.File({
      filename: args.log,
      format: winston.format.simple()
    }));
  }


  //
  // Configure the transport logger
  // This logs to the console always
  // Logs to a file if the --log option is used
  //

  var transLog = winston.createLogger({
    level: 'silly',
    // format: winston.format.json(),
    defaultMeta: { service: 'transaction' },
    transports: [

      new winston.transports.Console({
        format: consoleFormat,

        silent: (args.out > '')
      }),
    ]
  });

  // Logs to a file if the --log option is used
  if (args.log > '') {
    transLog.add(new winston.transports.File({
      filename: args.log,
      format: winston.format.simple()
    }));
  }


  var port;
  var device;

  if (config.master.transport.connection.type === 'serial') {

    // Open the serial port we are going to use
    port = new SerialPortFactory(
      config.port.name,
      config.port.options);

    // Make serial port instance available for the modbus master
    config.master.transport.connection.serialPort = port;

    createMaster();

    // Open the port
    // the 'open' event is triggered when complete
    if (args.v) {
      serialLog.info('Opening ' + config.port.name);
    }

    port.open(function(err) {
      if (err) {
        console.log(err);
        exit(1);
      }
    });
  } else if (config.master.transport.connection.type === 'websocket') {
    port = require('socket.io-client')(config.websocket.url, config.websocket);

    port.on('connect_error', function(err) {
      serialLog.info('[connection#connect_error]', err);
    });

    port.on('connect_timeout', function() {
      serialLog.info('[connection#connect_timeout]');
    });

    port.on('reconnect', function(attempt) {
      serialLog.info('[connection#reconnect] ', attempt);
    });

    port.on('reconnecting', function(attempt) {
      serialLog.info('[connection#reconnecting] ', attempt);
    });

    port.on('reconnect_error', function(err) {
      serialLog.info('[connection#reconnect_error] ', err);
    });

    port.on('reconnect_failed', function() {
      serialLog.info('[connection#reconnect_failed] ');
    });

    port.on('ping', function() {
      serialLog.info('[connection#ping] ');
    });

    port.on('pong', function(ms) {
      serialLog.info('[connection#pong] ', ms);
    });

    // Make socket instance available for the modbus master
    config.master.transport.connection.socket = port;
    createMaster();

  } else if (config.master.transport.connection.type === 'ble') {

    var BleControllerFactory = require('@csllc/cs-mb-ble');


    port = new BleControllerFactory();

    if (args.v) {
      port.on('scanStart', function() { serialLog.info('[connection#scanning]'); });
      port.on('scanStop', function() { serialLog.info('[connection#stopped]'); });
      port.on('warning', function(w) { serialLog.info('[connection#warning]', w); });
    }

    // Wait for the bluetooth hardware to become ready
    port.once('stateChange', function(state) {

      if (state === 'poweredOn') {

        // Listen for the first device found
        port.once('discover', function(peripheral) {

          port.stopScanning();

          // Create a new controller associated with the discovered peripheral
          var device = new port.Controller(peripheral);

          if (args.v) {
            device.on('connected', function() { serialLog.info('[connection#connected'); });
            device.on('disconnected', function() { serialLog.info('[connection#disconnected'); });

          }

          config.master.transport.connection.type = 'generic';
          config.master.transport.type = 'ip';
          config.master.transport.connection.device = device;

          // now connect to the device and let event handlers take over
          device.connect()

            .catch(function(err) {
              console.log('[device#error]', err);
            });

          createMaster();


        });

        // start looking for bluetooth devices
        port.startScanning();

      }

    });

  } else if (config.master.transport.connection.type === 'can-usb-com') {
    let CanUsbComm = require('can-usb-com');
    let J1939 = require('@csllc/j1939');

    config.canUsbComm.canRate = config.can.rate;
    config.canUsbComm.j1939.preferredAddress = config.can.myid;

    let canusbcom;

    canusbcom = new CanUsbComm(config.canUsbComm);
    port = new J1939(canusbcom, config.canUsbComm.j1939);

    // Make serial port instance available for the modbus master
    config.master.transport.connection.type = 'generic';
    config.master.transport.connection.device = port;

    createMaster();

    // Open the port
    // the 'open' event is triggered when complete
    if (args.v) {
      serialLog.info('Opening ' + config.port.name);
    }

    // Open the com port and configure...
    canusbcom.open(config.port.name)
      .catch(function(err) {
        console.log(err);
        exit(1);
      });

  } else if (config.master.transport.connection.type === 'can') {
    let CanBus = require('@csllc/cs-canbus-universal')
    let J1939 = require('@csllc/j1939');

    config.can.canRate = config.can.rate;
    config.can.j1939.preferredAddress = config.can.myid;

    let canbus;
    canbus = new CanBus(config.can);
    port = new J1939(canbus, config.can.j1939);

    // Make the CAN port instance available for the modbus master
    config.master.transport.connection.type = 'generic';
    config.master.transport.connection.device = port;

    createMaster();

    // Open the port; the 'open' event is emitted when complete
    if (args.v) {
      serialLog.info('Opening ' + config.port.name);
    }

    // Open the CAN port and configure
    port.open(config.port.name)
      .catch((err) => {
        console.error(err);
        exit(1);
      });
  }
}

function createMaster() {

  let transportType = config.master.transport.type;

  // Create the MODBUS master
  master = ModbusPort.createMaster(config.master);

  // Attach event handler for the port opening
  master.once('connected', function() {

    console.log('MASTER - connected');

    // remember when we started for timing purposes
    startTime = new Date().getTime();

    doAction();
  });

  // port errors
  port.on('error', function(err) {
    console.error(chalk.underline.bold(err.message));
  });

  // Hook events for logging


  var connection = master.getConnection();

  connection.on('open', function() {
    serialLog.info('[connection#open  ]');
  });

  connection.on('close', function() {
    serialLog.info('[connection#close]');
  });

  connection.on('error', function(err) {
    serialLog.error('Error: ', '[connection#error] ' + err.message);
  });

  connection.on('write', function(data) {
    if (isAscii) {
      serialLog.info('[TX] ' + data.toString());
    } else {
      serialLog.info('[TX] ' + util.inspect(data));
    }
  });

  connection.on('data', function(data) {
    if (isAscii) {
      serialLog.info('[RX] ' + data.toString());
    } else if (transportType !== 'j1939') {

      serialLog.info('[RX] ' + util.inspect(data));
    } else if (data.dst === config.can.myid) {
      serialLog.info('[RX] ' + util.inspect(data));

    }
  });

  var transport = master.getTransport();

  // catch event when a transaction starts.  Hook the events for logging
  transport.on('request', function(transaction) {

    transaction.once('timeout', function() {
      transLog.warn('[timeout]');
    });

    transaction.once('error', function(err) {
      transLog.error('[error] %s', err.message);
    });

    transaction.once('response', function(response) {
      if (response.isException()) {
        transLog.error(response.toString());
      } else {
        transLog.info(response.toString());
      }
    });

    transaction.once('complete', function(err, response) {
      if (err) {
        transLog.error('[complete] ', err.message);
      } else {
        transLog.info('[complete] %s', response);
      }
      //exit(0);
    });

    transaction.once('cancel', function() {
      transLog.warn('[cancel]');
    });


    transLog.info(transaction.getRequest().toString());
  });

  if (args.v) {
    // catch sniff messages (from tunnel transport only)
    transport.on('sniff', function(msg, buf) {
      transLog.info('[sniff] ' + msg, buf);
    });
  }
}
