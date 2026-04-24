const WebSocket = require('ws');
const db = require('../db');

let feeders = new Map();
let viewers = new Map();

function setupWebsocket(server) {
    const wss = new WebSocket.Server({ server });

    //esp32 poking
    async function notifyFeeder(feederID) {
        if (!feeders.has(feederID)) return;

        try {
            const wsClient = feeders.get(feederID);
            
            //feedconfig pull
            const [rows] = await db.promise().query(
                'SELECT feedTime, feedAmount, slot FROM feedconfig WHERE feederID = ? ORDER BY slot ASC', 
                [feederID]
            );

            let slots = [null, null, null]; 

            //slot checking
            rows.forEach(row => {
                if (row.slot >= 1 && row.slot <= 3) {
                    slots[row.slot - 1] = row;
                }
            });

            let rawData = "";
            let displayList = ""; 

            slots.forEach((row, index) => {
                if (row) {
                    const [h, m, s] = row.feedTime.split(':');
                    rawData += `${parseInt(h)}:${parseInt(m)}:${row.feedAmount};`;
                    displayList += `${index+1}. ${h}:${m} (${row.feedAmount}g)\n`;
                } else {
                    rawData += ";"; 
                    displayList += `${index+1}. --:--\n`;
                }
            });
            
            //sent json
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

//websocket connection
    wss.on('connection', (ws) => {
        let myFeederID = null; 
        let watchingID = null; 

        ws.on('error', (err) => {
            console.error(`⚠️ WebSocket Error (Feeder ${myFeederID}):`, err.message);
        });

        ws.on('message', async (message) => {
            const msgString = message.toString();
            //json checking
            const isJSON = msgString.trim().startsWith('{');
            const isBinary = Buffer.isBuffer(message);
            const isImageHeader = msgString.substring(0, 50).includes('JFIF');

            //streaming
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

            //json
            try {
                const data = JSON.parse(msgString);

                if (data.type === 'ack') {
                    if (myFeederID) {
                        console.log(`✅ [ACK] Feeder ${myFeederID} ยืนยันการรับข้อมูล: ${data.msg}`);
                    }
                }

                //register token
                if (data.type === 'register') {
                    const token = data.token;
                    const [rows] = await db.promise().query('SELECT feederID FROM petfeeders WHERE feederToken = ?', [token]);
                    
                    if (rows.length > 0) {
                        myFeederID = rows[0].feederID;
                        feeders.set(myFeederID, ws);
                        
                        // 🔥 อัปเดต DB isActive = 1 (เชื่อมต่อแล้ว)
                        await db.promise().query('UPDATE petfeeders SET isActive = 1 WHERE feederID = ?', [myFeederID]);
                        console.log(`✅ Feeder ID ${myFeederID} Online`);
                        
                        // 🔥 เพิ่มส่วนนี้: Broadcast สถานะ ONLINE ให้ Viewers
                        if (viewers.has(myFeederID)) {
                            viewers.get(myFeederID).forEach(viewer => {
                                if (viewer.readyState === WebSocket.OPEN) {
                                    viewer.send(JSON.stringify({
                                        type: 'device_status',
                                        feederID: myFeederID,
                                        status: 'online',
                                        message: '🟢 เชื่อมต่อกับ Server แล้ว'
                                    }));
                                }
                            });
                        }
                        
                        notifyFeeder(myFeederID);
                    }
                }

                if (data.type === 'watch') {
                    watchingID = parseInt(data.feederID);
                    if (!viewers.has(watchingID)) viewers.set(watchingID, new Set());
                    viewers.get(watchingID).add(ws);
                    console.log(`👀 Client watching Feeder ${watchingID}`);
                }
                
                //force refresh
                if (data.type === 'force_update_client') {
                    const targetID = parseInt(data.targetID);
                    setTimeout(() => notifyFeeder(targetID), 1000); 
                }

                //schedule request
                if (data.type === 'get_schedule') {
                    if (myFeederID) notifyFeeder(myFeederID);
                }

                //sensor
                if (data.type === 'update_sensor') {
                    if (myFeederID) {
                        const foodVal = data.food;
                        const waterVal = data.water;
                        const bowlFoodVal = data.bowlFood; 
                        const bowlWaterVal = data.bowlWater;

                        await db.promise().query(
                            'UPDATE petfeeders SET foodlvl = ?, waterlvl = ?, bowl_food = ?, bowl_water = ? WHERE feederID = ?',
                            [foodVal, waterVal, bowlFoodVal, bowlWaterVal, myFeederID]
                        );

                        // 🔥 เพิ่มส่วนนี้: Broadcast ไปให้ Viewers
                        if (viewers.has(myFeederID)) {
                            viewers.get(myFeederID).forEach(viewer => {
                                if (viewer.readyState === WebSocket.OPEN) {
                                    viewer.send(JSON.stringify({
                                        type: 'update_sensor',
                                        feederID: myFeederID,
                                        food: foodVal,
                                        water: waterVal,
                                        bowlFood: bowlFoodVal,
                                        bowlWater: bowlWaterVal
                                    }));
                                }
                            });
                        }
                    }
                }

                //schedule
                if (data.type === 'add_schedule_from_esp') {
                    if (myFeederID) {
                        const timeVal = data.time;     
                        const gramVal = data.duration; 
                        const slotVal = data.slot;

                        console.log(`🤖 ESP Update Slot ${slotVal}: ${timeVal} (${gramVal}g)`);

                        //delete schedule
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE feederID = ? AND slot = ?', 
                            [myFeederID, slotVal]
                        );

                        //insert schedule
                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, type, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?, ?)',
                            [myFeederID, 'food', timeVal, gramVal, slotVal]
                        );

                        notifyFeeder(myFeederID);
                    }
                }
                //schedule delete from esp32
                if (data.type === 'delete_schedule_from_esp') {
                    if (myFeederID) {
                        const timeVal = data.time;

                        console.log(`🗑️ ESP requested DELETE time: ${timeVal}`);

                        await db.promise().query(
                            "DELETE FROM feedconfig WHERE feederID = ? AND DATE_FORMAT(feedTime, '%H:%i') = ?", 
                            [myFeederID, timeVal]
                        );

                        notifyFeeder(myFeederID);
                    }
                }

                if (data.type === 'feed_log') {
                    if (myFeederID) {
                        const amountVal = data.amount;
                        const sourceVal = data.source;

                        console.log(`📝 Log: Feeder ${myFeederID} fed ${amountVal}g via ${sourceVal}`);

                        await db.promise().query(
                            'INSERT INTO feedlogs (feederID, amount, type, feedAt) VALUES (?, ?, ?, NOW())',
                            [myFeederID, amountVal, sourceVal]
                        );
                    }
                }

                if (data.type === 'manual_feed') {
                    const targetFeeder = parseInt(data.feederID);
                    const feedAmount = parseInt(data.amount);

                    console.log(`🌐 Web requested manual feed: ${feedAmount}g for Feeder ${targetFeeder}`);

                    if (feeders.has(targetFeeder)) {
                        const espWs = feeders.get(targetFeeder);
                        
                        if (espWs.readyState === WebSocket.OPEN) {
                            espWs.send(JSON.stringify({
                                type: 'manual_feed',
                                amount: feedAmount
                            }));
                            // 🔥 เติมบรรทัดนี้ลงไป เพื่อเช็คว่า Node.js ยิงออกไปจริงๆ
                            console.log(`✅ [Success] ยิงคำสั่งหมุนมอเตอร์ ${feedAmount}g ไปหา ESP32 สำเร็จ!`);
                        } else {
                            // 🔥 เติมบรรทัดนี้ เผื่อสายหลุดแต่ยังค้างในระบบ
                            console.log(`❌ [Fail] ESP32 เชื่อมต่ออยู่ แต่สถานะไม่ใช่ OPEN (ReadyState: ${espWs.readyState})`);
                        }
                    } else {
                        console.log(`⚠️ Feeder ${targetFeeder} is offline. Cannot manual feed.`);
                    }
                }

            } catch (err) {
                console.error("⚠️ Error processing message:", err.message);
            }
        });

        ws.on('close', async () => {
            if (myFeederID) {
                feeders.delete(myFeederID);
                
                // 🔥 อัปเดต DB isActive = 0 (ตัดการเชื่อมต่อ)
                await db.promise().query('UPDATE petfeeders SET isActive = 0 WHERE feederID = ?', [myFeederID]);
                console.log(`❌ Feeder ${myFeederID} Disconnected`);
                
                // 🔥 เพิ่มส่วนนี้: Broadcast สถานะ OFFLINE ให้ Viewers
                if (viewers.has(myFeederID)) {
                    viewers.get(myFeederID).forEach(viewer => {
                        if (viewer.readyState === WebSocket.OPEN) {
                            viewer.send(JSON.stringify({
                                type: 'device_status',
                                feederID: myFeederID,
                                status: 'offline',
                                message: '🔴 ตัดการเชื่อมต่อจาก Server'
                            }));
                        }
                    });
                }
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