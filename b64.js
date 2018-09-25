

    // // Transaction ID which is just echoed back to the sender
    // uint16_t transaction;

    // // Protocol indicator, should always be zero
    // uint16_t protocol;

    // // 2 bytes indicating number of bytes following the first 6 in the message
    // uint8_t lengthMsb;
    // uint8_t lengthLsb;

    // // Slave unit ID
    // uint8_t unit;

    // // MODBUS function code
    // uint8_t function;


let buf = Buffer.from([ 0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x11 ]);

  console.log( buf.toString('base64'));