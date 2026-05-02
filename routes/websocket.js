const { Server } = require('ws');  // 🔥 แก้ตรงนี้
const db = require('../db');

let feeders = new Map();
let cameras = new Map();
let viewers = new Map();

async function notifyFeeder(feederID) {
    try {
        // ดึงตารางเวลาทั้งหมด
        const [schedules] = await db.promise().query(
            'SELECT feedTime, feedAmount FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC',
            [feederID]
        );

        if (schedules.length === 0) {
            console.log(`ℹ️ No schedules for Feeder ${feederID}`);
            return;
        }

        // แปลงเป็นรูปแบบที่ ESP32 เข้าใจ (HH:MM:duration;HH:MM:duration;...)
        let scheduleString = '';
        schedules.forEach((schedule, index) => {
            const [hour, minute] = schedule.feedTime.split(':');
            scheduleString += `${hour}:${minute}:${schedule.feedAmount}`;
            if (index < schedules.length - 1) scheduleString += ';';
        });

        console.log(`📅 Schedule string for Feeder ${feederID}: ${scheduleString}`);

        // ส่งไปให้ Main Board (feeders)
        if (feeders.has(feederID)) {
            const espWs = feeders.get(feederID);

            if (espWs.readyState === WebSocket.OPEN) {
                espWs.send(JSON.stringify({
                    type: 'schedule_update',
                    raw: scheduleString
                }));
                console.log(`📤 Sent schedule to Main Board (Feeder ${feederID})`);
            } else {
                console.log(`❌ Main Board not OPEN (readyState: ${espWs.readyState})`);
            }
        } else {
            console.log(`⚠️ Main Board (Feeder ${feederID}) not connected`);
        }

    } catch (err) {
        console.error('Error in notifyFeeder:', err.message);
    }
}

function setupWebsocket(server) {
    const wss = new Server({ server });

    wss.on('connection', (ws) => {
        let myFeederID = null;
        let myRole = null;           // 🔥 เพิ่ม: เก็บ Role ของ Connection
        let watchingID = null;

        ws.on('message', async (message) => {
            const msgString = message.toString();
            const isJSON = msgString.trim().startsWith('{');
            const isBinary = Buffer.isBuffer(message);
            const isImageHeader = msgString.substring(0, 50).includes('JFIF');

            // ===== Handle Binary (Camera Stream) =====
            if ((isBinary || isImageHeader) && !isJSON) {
                // 🔥 ส่งไปให้ Main board (Feeder) ไม่ใช่ Camera
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

            // ===== Handle JSON =====
            try {
                const data = JSON.parse(msgString);

                // 🔥 Handle Register - แยกตาม Role
                if (data.type === 'register') {
                    // โค้ดใหม่ ESP32 ส่ง deviceId มาด้วย
                    const token = data.token;
                    const role = data.role;
                    const deviceId = data.deviceId; // ดึง deviceId มาใช้

                    console.log(`📋 Register request - Device: ${deviceId}, Role: ${role}, Token: ${token}`);

                    const [rows] = await db.promise().query(
                        'SELECT feederID FROM petfeeders WHERE feederToken = ?',
                        [token] // ยังคงเช็คกับ Token ใน DB เหมือนเดิม
                    );

                    if (rows.length > 0) {
                        myFeederID = rows[0].feederID;
                        myRole = role;

                        // 🔥 เก็บ Connection
                        if (role === 'main') {
                            feeders.set(myFeederID, ws);
                            console.log(`✅ Main Board (Feeder ${myFeederID}) Connected`);
                        } else if (role === 'camera') {
                            cameras.set(myFeederID, ws);
                            console.log(`✅ Camera Board (Feeder ${myFeederID}) Connected`);
                        }

                        // 🔥 อัปเดต DB
                        await db.promise().query(
                            'UPDATE petfeeders SET wsConnected = 1 WHERE feederID = ?',
                            [myFeederID]
                        );

                        // 🔥 **ส่วนสำคัญ**: Broadcast Status ปัจจุบันให้ Viewers
                        if (viewers.has(myFeederID)) {
                            const mainConnected = feeders.has(myFeederID);
                            const cameraConnected = cameras.has(myFeederID);

                            viewers.get(myFeederID).forEach(viewer => {
                                if (viewer.readyState === WebSocket.OPEN) {
                                    viewer.send(JSON.stringify({
                                        type: 'device_status',
                                        feederID: myFeederID,
                                        status: 'online', 
                                        mainConnected: mainConnected,
                                        cameraConnected: cameraConnected,
                                        message: mainConnected || cameraConnected ? '🟢 Device Online' : '🔴 Device Offline'
                                    }));
                                }
                            });
                        }
                    } else {
                            console.log(`⚠️ Register failed: Token not found in DB`);
                    }
                }

                // ===== Handle Watch =====
                if (data.type === 'watch') {
                    watchingID = parseInt(data.feederID);
                    if (!viewers.has(watchingID)) viewers.set(watchingID, new Set());
                    viewers.get(watchingID).add(ws);

                    console.log(`👀 Viewer watching Feeder ${watchingID}`);

                    // 🔥 ส่ง Status ปัจจุบัน
                    const mainConnected = feeders.has(watchingID);
                    const cameraConnected = cameras.has(watchingID);

                    ws.send(JSON.stringify({
                        type: 'device_status',
                        feederID: watchingID,
                        status: mainConnected ? 'online' : 'offline',
                        mainConnected: mainConnected,    // 🔥 บอก Main Status
                        cameraConnected: cameraConnected, // 🔥 บอก Camera Status
                        message: mainConnected ? '🟢 Main Online' : '🔴 Main Offline'
                    }));
                }

                // ===== Handle Update Sensor (จาก Main Board) =====
                if (data.type === 'update_sensor' && myRole === 'main') {
                    if (myFeederID) {
                        const { food, water, bowlFood, bowlWater } = data;

                        await db.promise().query(
                            'UPDATE petfeeders SET foodlvl = ?, waterlvl = ?, bowl_food = ?, bowl_water = ? WHERE feederID = ?',
                            [food, water, bowlFood, bowlWater, myFeederID]
                        );

                        // 🔥 Broadcast ไปให้ Viewers
                        if (viewers.has(myFeederID)) {
                            viewers.get(myFeederID).forEach(viewer => {
                                if (viewer.readyState === WebSocket.OPEN) {
                                    viewer.send(JSON.stringify({
                                        type: 'update_sensor',
                                        feederID: myFeederID,
                                        food, water, bowlFood, bowlWater
                                    }));
                                }
                            });
                        }
                    }
                }

                // ===== Handle Manual Feed =====
                if (data.type === 'manual_feed') {
                    const targetFeeder = parseInt(data.feederID);
                    const feedAmount = parseInt(data.amount);

                    console.log(`🌐 Web requested manual feed: ${feedAmount}g for Feeder ${targetFeeder}`);

                    // 🔥 ส่งไปให้ Main Board (feeders) ไม่ใช่ Camera
                    if (feeders.has(targetFeeder)) {
                        const espWs = feeders.get(targetFeeder);

                        if (espWs.readyState === WebSocket.OPEN) {
                            espWs.send(JSON.stringify({
                                type: 'manual_feed',
                                amount: feedAmount
                            }));
                            console.log(`✅ Sent manual_feed to Main Board (Feeder ${targetFeeder})`);
                        } else {
                            console.log(`❌ Main Board not OPEN`);
                        }
                    } else {
                        console.log(`⚠️ Main Board Feeder ${targetFeeder} is offline`);
                    }
                }

                // ===== Handle Feed Log (จาก Main Board) =====
                if (data.type === 'feed_log' && myRole === 'main') {
                    if (myFeederID) {
                        const { amount, source } = data;
                        await db.promise().query(
                            'INSERT INTO feedlogs (feederID, amount, type, feedAt) VALUES (?, ?, ?, NOW())',
                            [myFeederID, amount, source]
                        );
                        console.log(`📝 Logged: ${amount}g from ${source}`);
                    }
                }

                if (data.type === 'add_schedule_from_web') {
                    const targetFeeder = parseInt(data.feederID);
                    const feedTime = data.feedTime;      // "10:30"
                    const feedAmount = data.feedAmount;  // 50

                    console.log(`📅 Add schedule from Web: ${feedTime} - ${feedAmount}g for Feeder ${targetFeeder}`);

                    try {
                        // 🔥 บันทึกลง DB
                        const timeForDB = `${feedTime}:00`;
                        
                        const [existing] = await db.promise().query(
                            'SELECT * FROM feedconfig WHERE feederID = ? AND feedTime = ?',
                            [targetFeeder, timeForDB]
                        );

                        if (existing.length > 0) {
                            console.log(`⚠️ Schedule already exists`);
                            return;
                        }

                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, feedTime, feedAmount) VALUES (?, ?, ?)',
                            [targetFeeder, timeForDB, feedAmount]
                        );

                        console.log(`✅ Schedule saved to DB`);

                        // 🔥 ส่งไปให้ Main Board ให้ส่ง Schedule ใหม่
                        if (feeders.has(targetFeeder)) {
                            const espWs = feeders.get(targetFeeder);

                            if (espWs && espWs.readyState === WebSocket.OPEN) {
                                // ดึงตารางเวลาทั้งหมด
                                const [schedules] = await db.promise().query(
                                    'SELECT feedTime, feedAmount FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC',
                                    [targetFeeder]
                                );

                                let scheduleString = '';
                                schedules.forEach((schedule, index) => {
                                    const [hour, minute] = schedule.feedTime.split(':');
                                    scheduleString += `${hour}:${minute}:${schedule.feedAmount}`;
                                    if (index < schedules.length - 1) scheduleString += ';';
                                });

                                espWs.send(JSON.stringify({
                                    type: 'schedule_update',
                                    raw: scheduleString
                                }));

                                console.log(`📤 Sent updated schedule to Main Board: ${scheduleString}`);
                            } else {
                                console.log(`❌ Main Board not OPEN`);
                            }
                        } else {
                            console.log(`⚠️ Main Board (Feeder ${targetFeeder}) offline`);
                        }

                    } catch (err) {
                        console.error('❌ Error adding schedule:', err.message);
                    }
                }

                // ===== Handle Delete Schedule from Web =====
                if (data.type === 'delete_schedule_from_web') {
                    const targetFeeder = parseInt(data.feederID);
                    const configID = parseInt(data.configID);

                    console.log(`🗑️ Delete schedule from Web: Config ${configID} for Feeder ${targetFeeder}`);

                    try {
                        // 🔥 ลบจาก DB
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE conID = ? AND feederID = ?',
                            [configID, targetFeeder]
                        );

                        console.log(`✅ Schedule deleted from DB`);

                        // 🔥 ส่งตารางเวลาที่อัปเดตไปให้ Main Board
                        if (feeders.has(targetFeeder)) {
                            const espWs = feeders.get(targetFeeder);

                            if (espWs && espWs.readyState === WebSocket.OPEN) {
                                // ดึงตารางเวลาที่เหลือ
                                const [schedules] = await db.promise().query(
                                    'SELECT feedTime, feedAmount FROM feedconfig WHERE feederID = ? ORDER BY feedTime ASC',
                                    [targetFeeder]
                                );

                                let scheduleString = '';
                                if (schedules.length > 0) {
                                    schedules.forEach((schedule, index) => {
                                        const [hour, minute] = schedule.feedTime.split(':');
                                        scheduleString += `${hour}:${minute}:${schedule.feedAmount}`;
                                        if (index < schedules.length - 1) scheduleString += ';';
                                    });
                                } else {
                                    scheduleString = '';  // ถ้าลบหมดเลย
                                }

                                espWs.send(JSON.stringify({
                                    type: 'schedule_update',
                                    raw: scheduleString
                                }));

                                console.log(`📤 Sent updated schedule to Main Board: ${scheduleString || '(empty)'}`);
                            } else {
                                console.log(`❌ Main Board not OPEN`);
                            }
                        } else {
                            console.log(`⚠️ Main Board (Feeder ${targetFeeder}) offline`);
                        }

                    } catch (err) {
                        console.error('❌ Error deleting schedule:', err.message);
                    }
                }

                // ===== 3. Handle Add Schedule from ESP32 =====
                if (data.type === 'add_schedule_from_esp') {
                    const targetFeeder = myFeederID;
                    const feedTime = data.time;         // รูปแบบ "HH:MM"
                    const feedAmount = data.duration;   // น้ำหนัก (กรัม)
                    const slot = data.slot;             // ช่องที่ 1, 2, 3

                    console.log(`📱 ESP32 added schedule: Slot ${slot} -> ${feedTime} - ${feedAmount}g`);

                    try {
                        const timeForDB = `${feedTime}:00`;

                        // เช็คว่าเวลานี้มีอยู่แล้วหรือยัง ถ้ามีให้ Update ถ้าไม่มีให้ Insert
                        const [existing] = await db.promise().query(
                            'SELECT * FROM feedconfig WHERE feederID = ? AND feedTime = ?',
                            [targetFeeder, timeForDB]
                        );

                        if (existing.length === 0) {
                            await db.promise().query(
                                'INSERT INTO feedconfig (feederID, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?)',
                                [targetFeeder, timeForDB, feedAmount, slot]
                            );
                            console.log(`✅ ESP32 Schedule saved to Web DB`);
                        }
                    } catch (err) {
                        console.error('❌ Error saving ESP32 schedule:', err.message);
                    }
                }

                // ===== 4. Handle Delete Schedule from ESP32 =====
                if (data.type === 'delete_schedule_from_esp') {
                    const targetFeeder = myFeederID;
                    const feedTime = data.time; // รูปแบบ "HH:MM"

                    console.log(`📱 ESP32 deleted schedule at: ${feedTime}`);

                    try {
                        const timeForDB = `${feedTime}:00`;
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE feederID = ? AND feedTime = ?',
                            [targetFeeder, timeForDB]
                        );
                        console.log(`✅ ESP32 Schedule deleted from Web DB`);
                    } catch (err) {
                        console.error('❌ Error deleting ESP32 schedule:', err.message);
                    }
                }

                // ===== Handle Factory Reset (จาก Main Board) =====
                if (data.type === 'factory_reset' && myRole === 'main') {
                     if (myFeederID) {
                          console.log(`⚠️ Factory Reset requested for Feeder ${myFeederID} by Device ${data.deviceId}`);
                          
                          try {
                               // ลบตารางเวลา
                               await db.promise().query('DELETE FROM feedconfig WHERE feederID = ?', [myFeederID]);
                               // ลบประวัติ
                               await db.promise().query('DELETE FROM feedlogs WHERE feederID = ?', [myFeederID]);
                               // รีเซ็ตการตั้งค่าเครื่องและเจ้าของ
                               await db.promise().query(
                                   'UPDATE petfeeders SET userID = NULL, isActive = 0, wsConnected = 0, feederName = ? WHERE feederID = ?', 
                                   ['Smart Pet Feeder', myFeederID]
                               );
                               // ลบ Dashboard ที่ผูกอยู่
                               await db.promise().query('DELETE FROM dashboards WHERE feederID = ?', [myFeederID]);

                               console.log(`✅ Factory Reset completed for Feeder ${myFeederID}`);
                          } catch (err) {
                               console.error(`❌ Error during Factory Reset:`, err.message);
                          }
                     }
                }

            } catch (err) {
                console.error("Message error:", err.message);
            }
        });

        // ===== Handle Close =====
        ws.on('close', async () => {
            if (myFeederID) {
                if (myRole === 'main') {
                    feeders.delete(myFeederID);
                    console.log(`❌ Main Board (Feeder ${myFeederID}) Disconnected`);
                } else if (myRole === 'camera') {
                    cameras.delete(myFeederID);
                    console.log(`❌ Camera Board (Feeder ${myFeederID}) Disconnected`);
                }

                // 🔥 อัปเดต DB
                await db.promise().query(
                    'UPDATE petfeeders SET wsConnected = 0 WHERE feederID = ?',
                    [myFeederID]
                );

                // 🔥 Broadcast Offline Status
                if (viewers.has(myFeederID)) {
                    viewers.get(myFeederID).forEach(viewer => {
                        if (viewer.readyState === WebSocket.OPEN) {
                            viewer.send(JSON.stringify({
                                type: 'device_status',
                                feederID: myFeederID,
                                status: 'offline',
                                role: myRole,
                                message: `🔴 ${myRole.toUpperCase()} Offline`
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