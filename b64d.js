

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



let b64string = "AAEAAQAnABEB/wAAADAwMzMwMDAwQThGQUYyRjE0RTQ1NDM4NTgwMTYwMDEA=";

  console.log(  Buffer.from(b64string, 'base64') );