# cs-modbus-cli

This package provides a command line interface to @csllc/cs-modbus to implement a MODBUS master.

To install the package globally, use 
`npm install -g @csllc/cs-modbus-cli`.

The `mb ...` command will then be available on your path. 

For development purposes, clone or download the repository, and use
`npm install`
to install the dependencies.
In this case the correct command to run the utility is `node mb ...`

## Usage

`mb -h` displays the online help including the options.

In order to have a successful MODBUS connection, you need to correctly configure the master.  The configuration items can be specified on the command line, stored in environment variables, or stored in a 'defaults' file.  The command line switches take the highest precedence, and the defaults file is lowest.

To save the current configuration to the defaults file, append `--save` to any command.  To view the configuration, use the `--show` command line switch.

### Configuration

#### Connection 
The connection represents the physical connection to the MODBUS slave(s).
Command line:  `--connection`
Environment variable: `MODBUS_CONNECTION`

Examples:
`--connection=serial` to use a serial (COM) port
`--connection=can-usb-com` to use a CAN-USB-COM CANBUS adapter

##### Baud Rate
For serial connections, a baud rate may be specified:
Command line:  `--baudrate`
Environment variable: `MODBUS_BAUDRATE`


#### Transport
The transport determines how the MODBUS PDUs are packaged when sent over the Connection.
Command line:  `--transport`
Environment variable: `MODBUS_TRANSPORT`

Examples: 
`--transport=rtu` for the MODBUS-RTU transport (eg. over a 'serial' connection)
`--transport=j1939` for MODBUS over J1939 CANBUS connection

#### Unit
Determines the slave ID to which the commands will be targeted
Command line:  `--unit`
Environment variable: `MODBUS_SLAVE`

#### CANBUS Rate
For CANBUS connections, the bus speed can be specified like:

Command line:  `--canrate`
Environment variable: `MODBUS_CANRATE`

#### CANBUS ID
For CANBUS connections, the bus ID used by the master can be specified using

Command line:  `--canid`
Environment variable: `MODBUS_CANID`

### Examples

List all serial ports available on the system
`mb -l --connection=serial`

Read the ID information from a slave using MODBUS-RTU over serial port
`mb read slave --connection=serial --transport=rtu --baudrate=9600 --slave=10`

Adding the `--save` option allows you to omit the configuration for later commands:
`mb read slave --connection=serial --transport=rtu --baudrate=9600 --slave=10 --save`


Read a block of memory from the slave using stored configuration:
`mb read memory 0x0000 16`

Read a block of memory from a slave using CANBUS and save settings
`mb read memory --connection=can-usb-com --transport=j1939 --canrate=250000 --slave=10 --save`

Read an object from the same device:
`mb read object 1`

Write 2 bytes of memory (note that values prefixed by 0x are interpreted as hex)
`mb write memory 0x400 0x55 0xAA`

