const WebSocket = require('ws');
const db = require('../db');

// 1. Map เก็บเครื่อง Feeder (Key: feederID, Value: ws_client)
let feeders = new Map();
// 2. Map เก็บคนดู (Key: feederID, Value: Set ของ ws_client) 
let viewers = new Map();

function setupWebsocket(server) {
    const wss = new WebSocket.Server({ server });

    // ============================================================
    // 🛠️ ฟังก์ชันช่วย: ดึงตารางเวลาจาก DB ส่งให้ ESP32
    // ============================================================
    async function notifyFeeder(feederID) {
        if (!feeders.has(feederID)) return;

        try {
            const wsClient = feeders.get(feederID);
            
            // ดึงข้อมูลจากตาราง feedconfig
            const [rows] = await db.promise().query(
                'SELECT feedTime, feedDura, slot FROM feedconfig WHERE feederID = ? ORDER BY slot ASC', 
                [feederID]
            );

            let slots = [null, null, null]; 

            // เอาข้อมูลจาก DB หยอดลงหลุมให้ถูกช่อง (Slot 1->Index 0, Slot 2->Index 1...)
            rows.forEach(row => {
                if (row.slot >= 1 && row.slot <= 3) {
                    slots[row.slot - 1] = row;
                }
            });

            let rawData = "";
            let displayList = ""; 

            // วนลูปสร้าง String ให้ครบ 3 ช่องเสมอ
            slots.forEach((row, index) => {
                if (row) {
                    // ถ้ามีข้อมูล
                    const [h, m, s] = row.feedTime.split(':');
                    rawData += `${parseInt(h)}:${parseInt(m)}:${row.feedDura};`;
                    displayList += `${index+1}. ${h}:${m} (${row.feedDura}g)\n`;
                } else {
                    // 🔥 ถ้าไม่มีข้อมูล (ว่าง) ให้ส่งเครื่องหมาย ; เปล่าๆ ไปจองที่ไว้
                    rawData += ";"; 
                    displayList += `${index+1}. --:--\n`;
                }
            });

            if (wsClient.readyState === WebSocket.OPEN) {
                wsClient.send(JSON.stringify({
                    type: "schedule_update",
                    raw: rawData, // ส่งแบบ Raw ให้ ESP32 ไป parseSchedule
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
        let myFeederID = null; 
        let watchingID = null; 

        ws.on('message', async (message) => {
            const msgString = message.toString();
            
            // เช็คว่าเป็น JSON หรือไม่
            const isJSON = msgString.trim().startsWith('{');
            const isBinary = Buffer.isBuffer(message);
            const isImageHeader = msgString.substring(0, 50).includes('JFIF');

            // --- ส่วนจัดการรูปภาพ (Streaming) ---
            if ((isBinary || isImageHeader) && !isJSON) {
                if (myFeederID && viewers.has(myFeederID)) {
                    const clients = viewers.get(myFeederID);
                    clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(message); 
                        }
                    });
                }
                return; 
            }

            // --- ส่วนจัดการคำสั่ง (JSON) ---
            try {
                const data = JSON.parse(msgString);

                // 1. Register (ESP32 รายงานตัว)
                if (data.type === 'register') {
                    const token = data.token;
                    const [rows] = await db.promise().query('SELECT feederID FROM petfeeders WHERE feederToken = ?', [token]);
                    if (rows.length > 0) {
                        myFeederID = rows[0].feederID;
                        feeders.set(myFeederID, ws);
                        await db.promise().query('UPDATE petfeeders SET isActive = 1 WHERE feederID = ?', [myFeederID]);
                        console.log(`✅ Feeder ID ${myFeederID} Online`);
                        
                        // ส่งตารางเวลาล่าสุดกลับไปให้ ESP32 ทันทีที่ต่อติด
                        notifyFeeder(myFeederID);
                    }
                }

                // 2. Watch (หน้าเว็บขอดู)
                if (data.type === 'watch') {
                    watchingID = parseInt(data.feederID);
                    if (!viewers.has(watchingID)) viewers.set(watchingID, new Set());
                    viewers.get(watchingID).add(ws);
                    console.log(`👀 Client watching Feeder ${watchingID}`);
                }
                
                // 3. Add Schedule (จากหน้าเว็บ)
                 if (data.type === 'add_schedule') {
                     if (myFeederID) { // อันนี้แปลกๆ ปกติหน้าเว็บจะไม่มี myFeederID เช็ค logic นี้หน้าเว็บอีกทีนะครับ
                        // แต่ถ้า Logic เดิมคุณถูกแล้วก็ปล่อยไว้
                    }
                }

                // 4. Force Update (หน้าเว็บสั่งให้ refresh)
                if (data.type === 'force_update_client') {
                    const targetID = parseInt(data.targetID);
                    setTimeout(() => notifyFeeder(targetID), 1000); 
                }

                // 5. Get Schedule (ขอข้อมูลตาราง)
                if (data.type === 'get_schedule') {
                    if (myFeederID) notifyFeeder(myFeederID);
                }

                // ========================================================
                // 🔥 [เพิ่มใหม่] รับค่า Sensor จาก ESP32 (Food/Water)
                // ========================================================
                if (data.type === 'update_sensor') {
                    if (myFeederID) {
                        const foodVal = data.food;   // รับค่า food (int)
                        const waterVal = data.water; // รับค่า water (int)

                        // อัปเดตลงตาราง petfeeders
                        // food -> foodlvl, water -> waterlvl
                        await db.promise().query(
                            'UPDATE petfeeders SET foodlvl = ?, waterlvl = ? WHERE feederID = ?',
                            [foodVal, waterVal, myFeederID]
                        );
                    }
                }

                // ========================================================
                // 🔥 [เพิ่มใหม่] ESP32 สั่งเพิ่มตารางเวลา (Add Schedule)
                // ========================================================
                if (data.type === 'add_schedule_from_esp') {
                    if (myFeederID) {
                        const timeVal = data.time;     
                        const gramVal = data.duration; 
                        const slotVal = data.slot;

                        console.log(`🤖 ESP Update Slot ${slotVal}: ${timeVal} (${gramVal}g)`);

                        // 2. ลบข้อมูลเก่าใน Slot นั้นทิ้งก่อน (ถ้ามี) เพื่อกันซ้ำ
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE feederID = ? AND slot = ?', 
                            [myFeederID, slotVal]
                        );

                        // 3. ใส่ข้อมูลใหม่ลงไปใน Slot เดิม (พร้อมระบุ slot)
                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, type, feedTime, feedDura, slot) VALUES (?, ?, ?, ?, ?)',
                            [myFeederID, 'food', timeVal, gramVal, slotVal]
                        );

                        // 4. Sync กลับไปที่ ESP32
                        notifyFeeder(myFeederID);
                    }
                }

                if (data.type === 'delete_schedule_from_esp') {
                    if (myFeederID) {
                        const timeVal = data.time; // รับค่าเวลาที่ต้องการลบ (เช่น "08:30")
                        
                        console.log(`🗑️ ESP requested DELETE time: ${timeVal}`);

                        // ลบข้อมูลใน DB ที่ตรงกับ FeederID และ เวลา (ใช้ DATE_FORMAT เพื่อเทียบแค่ HH:MM)
                        await db.promise().query(
                            "DELETE FROM feedconfig WHERE feederID = ? AND DATE_FORMAT(feedTime, '%H:%i') = ?", 
                            [myFeederID, timeVal]
                        );

                        // สั่ง Sync ข้อมูลล่าสุดกลับไปให้ ESP32 (เพื่อความชัวร์)
                        notifyFeeder(myFeederID);
                    }
                }

            } catch (err) {
                console.error("⚠️ Error processing message:", err.message);
            }
        });

        // เมื่อหลุดการเชื่อมต่อ
        ws.on('close', async () => {
            if (myFeederID) {
                feeders.delete(myFeederID);
                await db.promise().query('UPDATE petfeeders SET isActive = 0 WHERE feederID = ?', [myFeederID]);
                console.log(`❌ Feeder ${myFeederID} Disconnected`);
            }
            if (watchingID && viewers.has(watchingID)) {
                viewers.get(watchingID).delete(ws);
                if (viewers.get(watchingID).size === 0) {
                    viewers.delete(watchingID);
                }
            }
        });
    });
}

module.exports = setupWebsocket;