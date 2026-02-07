const WebSocket = require('ws');
const db = require('../db');

// 1. Map เก็บเครื่อง Feeder (Key: feederID, Value: ws_client)
let feeders = new Map();
// 2. 🔥 Map เก็บคนดู (Key: feederID, Value: Set ของ ws_client) 
// ต้องใช้ Set เพราะ 1 เครื่องอาจมีคนดูหลายคนพร้อมกัน
let viewers = new Map();

function setupWebsocket(server) {
    const wss = new WebSocket.Server({ server });

    // ============================================================
    // 🛠️ ฟังก์ชันช่วย: ดึงข้อมูลล่าสุดจาก DB แล้วส่งยัดใส่มือ ESP32
    // ============================================================
    async function notifyFeeder(feederID) {
        if (!feeders.has(feederID)) return;

        try {
            const wsClient = feeders.get(feederID);
            
            // ดึงข้อมูลเรียงตามเวลา
            const [rows] = await db.promise().query(
                'SELECT feedTime, feedDura FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC', 
                [feederID]
            );

            // รูปแบบ: H:M:D;H:M:D; (เช่น 8:30:10;18:45:5;)
            let rawData = "";
            let displayList = ""; 

            if (rows.length > 0) {
                rows.forEach((row, index) => {
                    const [h, m, s] = row.feedTime.split(':');
                    const dura = row.feedDura;
                    rawData += `${parseInt(h)}:${parseInt(m)}:${dura};`;
                    displayList += `${index+1}. ${row.feedTime} (${dura}s)\n`;
                });
            } else {
                displayList = "No Schedule";
            }

            if (wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(JSON.stringify({
                    type: "schedule_update",
                    raw: rawData,
                    text: displayList
                }));
                console.log(`📡 Sent schedule to Feeder ${feederID}: ${rawData}`);
            }

        } catch (err) {
            console.error("Notify Error:", err);
        }
    }

    // ============================================================
    // 🔌 การเชื่อมต่อ WebSocket
    // ============================================================
    wss.on('connection', (ws) => {
        let myFeederID = null; // เก็บว่า Socket นี้เป็นของ Feeder ID อะไร (ถ้าเป็น ESP32)
        let watchingID = null; // เก็บว่า Socket นี้กำลังดู ID อะไร (ถ้าเป็นหน้าเว็บ)

        ws.on('message', async (message) => {
            
            // แปลงข้อมูลเป็นข้อความก่อน เพื่อเช็คว่าเป็น JSON หรือไม่
            const msgString = message.toString();
            
            // 🔍 เช็คว่าเป็น JSON หรือไม่? (ถ้าขึ้นต้นด้วย { แปลว่าน่าจะเป็นคำสั่ง ไม่ใช่รูป)
            const isJSON = msgString.trim().startsWith('{');

            // 🔍 เช็คว่าเป็นรูปภาพหรือไม่?
            // (ต้องเป็น Buffer และไม่ใช่ JSON หรือมีหัวไฟล์ JFIF)
            const isBinary = Buffer.isBuffer(message);
            const isImageHeader = msgString.substring(0, 50).includes('JFIF');

            // 🔥 กฎใหม่: ถ้าเป็น Binary หรือ JFIF "และต้องไม่ใช่ JSON" ถึงจะนับเป็นรูป
            if ((isBinary || isImageHeader) && !isJSON) {
                
                if (myFeederID && viewers.has(myFeederID)) {
                    const clients = viewers.get(myFeederID);
                    // console.log(`📸 Sending image from ${myFeederID}`); // เปิด Log นี้ถ้าอยากเช็ค
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(message); 
                        }
                    });
                }
                return; // ⛔️ จบงานรูปภาพตรงนี้
            }

            // 📝 ส่วนจัดการคำสั่ง (JSON)
            try {
                // ถ้ามาถึงตรงนี้ แสดงว่าเป็น JSON (แม้จะมาเป็น Buffer ก็แปลงได้)
                const data = JSON.parse(msgString);

                // ... (Logic เดิมด้านล่างทั้งหมด เหมือนเดิมไม่ต้องแก้) ...
                
                // 1. Register
                if (data.type === 'register') {
                    // ... โค้ด register เดิม ...
                    const token = data.token;
                    const [rows] = await db.promise().query('SELECT feederID FROM petfeeders WHERE feederToken = ?', [token]);
                    if (rows.length > 0) {
                        myFeederID = rows[0].feederID;
                        feeders.set(myFeederID, ws);
                        await db.promise().query('UPDATE petfeeders SET isActive = 1 WHERE feederID = ?', [myFeederID]);
                        console.log(`✅ Feeder ID ${myFeederID} Online`); // <-- บรรทัดนี้ต้องขึ้น!
                        notifyFeeder(myFeederID);
                    }
                }

                // ... (Logic อื่นๆ: watch, add_schedule, force_update... ปล่อยไว้เหมือนเดิม) ...
                // 2. Watch
                if (data.type === 'watch') {
                    watchingID = parseInt(data.feederID);
                    if (!viewers.has(watchingID)) viewers.set(watchingID, new Set());
                    viewers.get(watchingID).add(ws);
                    console.log(`👀 Client watching Feeder ${watchingID}`);
                }
                
                // 3. Add Schedule
                 if (data.type === 'add_schedule') {
                     if (myFeederID) {
                        const timeVal = data.time;
                        const duraVal = data.duration;
                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, type, feedTime, feedDura) VALUES (?, ?, ?, ?)',
                            [myFeederID, 'food', timeVal, duraVal]
                        );
                        notifyFeeder(myFeederID);
                    }
                }

                // 4. Force Update
                if (data.type === 'force_update_client') {
                    const targetID = parseInt(data.targetID);
                    setTimeout(() => notifyFeeder(targetID), 1000); 
                }

                // 5. Get Schedule
                if (data.type === 'get_schedule') {
                    if (myFeederID) notifyFeeder(myFeederID);
                }

            } catch (err) {
                console.error("⚠️ Error processing message:", err.message);
            }

            try {
                const data = JSON.parse(msgString);

                // ... (ส่วน Register, Watch, Add Schedule จากเว็บ เหมือนเดิม) ...

                // ➤ (ใหม่) รับคำสั่งเพิ่มเวลาจาก ESP32 (ผ่าน Serial)
                if (data.type === 'add_schedule_from_esp') {
                    if (myFeederID) {
                        const timeVal = data.time;     // เช่น "08:30"
                        const duraVal = data.duration; // เช่น 5
                        
                        console.log(`🤖 ESP requested ADD: ${timeVal} (${duraVal}s)`);

                        // เพิ่มลง Database (ตาราง feedconfig)
                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, type, feedTime, feedDura) VALUES (?, ?, ?, ?)',
                            [myFeederID, 'food', timeVal, duraVal]
                        );

                        // สั่งให้ ESP32 อัปเดตตารางเวลาใหม่ทันที
                        notifyFeeder(myFeederID);
                    }
                }

            } catch (err) {
                console.error("⚠️ Error processing message:", err.message);
            }
        });

        // ============================================================
        // ❌ เมื่อการเชื่อมต่อหลุด (Close)
        // ============================================================
        ws.on('close', async () => {
            // ถ้า Feeder หลุด
            if (myFeederID) {
                feeders.delete(myFeederID);
                await db.promise().query('UPDATE petfeeders SET isActive = 0 WHERE feederID = ?', [myFeederID]);
                console.log(`❌ Feeder ${myFeederID} Disconnected`);
            }
            // ถ้าคนดูหลุด -> 🔥 ต้องเอาออกจาก Map คนดูด้วย
            if (watchingID && viewers.has(watchingID)) {
                viewers.get(watchingID).delete(ws);
                // ถ้าไม่มีคนดูเหลือแล้ว ลบ Key ทิ้งไปเลยก็ได้เพื่อประหยัด Mem
                if (viewers.get(watchingID).size === 0) {
                    viewers.delete(watchingID);
                }
            }
        });
    });
}

module.exports = setupWebsocket;