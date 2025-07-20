const WebSocket = require('ws');

// let lastImageBuffer = null;

function setupWebsocket(server) {
    const wss = new WebSocket.Server({ server });

    // wss.on('connection', ws => {
    // console.log('✅ WebSocket Connected');

    // ws.on('message', (data, isBinary) => {
    //     if (isBinary) {
    //     console.log('Received image binary data:', data.length, 'bytes');
    //     lastImageBuffer = data;

    //     // broadcast ให้ทุก client ที่เป็น browser
    //     wss.clients.forEach(client => {
    //         if (client !== ws && client.readyState === WebSocket.OPEN) {
    //         client.send(data, { binary: true });
    //         }
    //     });
    //     } else {
    //     console.log('📨 Message:', data.toString());
    //     }
    // });
    // });

    wss.on('connection', ws => {
    console.log('✅ Browser or ESP connected');

    ws.on('message', (data, isBinary) => {
        if (!isBinary) {
        const text = data.toString();
        console.log('📨 Message:', text);

        // ส่งข้อความต่อให้ทุก browser
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(text);  // ส่งเป็นข้อความ
            }
        });
        }
    });
    });
    return wss;
}

module.exports = setupWebsocket;