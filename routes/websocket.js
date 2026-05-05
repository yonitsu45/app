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

    const interval = setInterval(() => {
        wss.clients.forEach(async (ws) => { // 👈 เติมคำว่า async ตรงนี้
            if (ws.isAlive === false) {
                console.log('💀 Ghost connection detected! Force terminating...');

                // 🌟 เพิ่มคำสั่งตรงนี้: ให้ไปค้นหาว่าเครื่องที่ตายคือ Feeder ID อะไร
                for (let [id, client] of feeders.entries()) {
                    if (client === ws) {
                        console.log(`🔌 Database updated: Feeder ${id} is OFFLINE`);
                        // สั่งอัปเดต Database ให้เป็น 0 (ไม่เชื่อมต่อ)
                        await db.promise().query(
                            'UPDATE petfeeders SET wsConnected = 0 WHERE feederID = ?',
                            [id]
                        );
                        feeders.delete(id); // ลบออกจาก Map
                        break;
                    }
                }
                for (let [id, client] of cameras.entries()) {
                    if (client === ws) {
                        cameras.delete(id);
                        break;
                    }
                }

                return ws.terminate(); // เตะออก
            }
            ws.isAlive = false;
            ws.ping();
        });
    }, 10000);

    wss.on('close', () => {
        clearInterval(interval); // ปิดการเช็คเมื่อเซิร์ฟเวอร์ปิด
    });

    wss.on('connection', (ws) => {
        let myFeederID = null;
        let myRole = null;           // 🔥 เพิ่ม: เก็บ Role ของ Connection
        let watchingID = null;

        ws.isAlive = true; 
        ws.on('pong', () => {
            ws.isAlive = true; 
        });

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
                        const timeForDB = `${feedTime}:00`;
                        
                        const [existing] = await db.promise().query(
                            'SELECT * FROM feedconfig WHERE feederID = ? AND feedTime = ?',
                            [targetFeeder, timeForDB]
                        );

                        if (existing.length > 0) {
                            console.log(`⚠️ Schedule already exists`);
                            return;
                        }

                        // 🌟 1. หาช่อง Slot ว่าง (1, 2 หรือ 3) เพื่อป้องกันการทับกัน
                        const [existingSlots] = await db.promise().query(
                            'SELECT slot FROM feedconfig WHERE feederID = ?',
                            [targetFeeder]
                        );
                        
                        const usedSlots = existingSlots.map(row => row.slot);
                        let targetSlot = null;
                        if (!usedSlots.includes(1)) targetSlot = 1;
                        else if (!usedSlots.includes(2)) targetSlot = 2;
                        else if (!usedSlots.includes(3)) targetSlot = 3;

                        if (targetSlot === null) return; // เต็ม 3 รอบแล้ว

                        // 🌟 2. INSERT ข้อมูลลงฐานข้อมูล โดยระบุ slot ด้วย!
                        await db.promise().query(
                            'INSERT INTO feedconfig (feederID, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?)',
                            [targetFeeder, timeForDB, feedAmount, targetSlot]
                        );

                        console.log(`✅ Schedule saved to DB at Slot ${targetSlot}`);

                        // 🌟 3. แพ็คข้อมูลส่งให้ ESP32 แบบล็อกตำแหน่ง Slot (ใช้ empty จองที่)
                        if (feeders.has(targetFeeder)) {
                            const espWs = feeders.get(targetFeeder);

                            if (espWs && espWs.readyState === 1 /* WebSocket.OPEN */) {
                                
                                const [schedules] = await db.promise().query(
                                    'SELECT feedTime, feedAmount, slot FROM feedconfig WHERE feederID = ?',
                                    [targetFeeder]
                                );

                                // สร้างกล่องเปล่า 3 ใบรอไว้
                                let scheduleArray = ['empty', 'empty', 'empty'];

                                // เอาข้อมูลเวลายัดใส่กล่องให้ตรงช่อง
                                schedules.forEach(sc => {
                                    if (sc.slot >= 1 && sc.slot <= 3) {
                                        const [hour, minute] = sc.feedTime.split(':');
                                        scheduleArray[sc.slot - 1] = `${hour}:${minute}:${sc.feedAmount}`;
                                    }
                                });

                                // ประกอบร่าง (เช่น "02:00:10;empty;22:00:10")
                                const scheduleString = scheduleArray.join(';');

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
                                    'SELECT feedTime, feedAmount, slot FROM feedconfig WHERE feederID = ?',
                                    [targetFeeder]
                                );

                                // 1. สร้างกล่องว่าง 3 ช่องรอไว้ก่อน (ตรงกับหน้าจอเครื่องพอดี)
                                let scheduleArray = ['empty', 'empty', 'empty'];

                                // 2. จับเวลาไปยัดใส่ตามตำแหน่ง Slot แบบเป๊ะๆ
                                schedules.forEach(sc => {
                                    const [hour, minute] = sc.feedTime.split(':');
                                    scheduleArray[sc.slot - 1] = `${hour}:${minute}:${sc.feedAmount}`; // slot 1 จะอยู่ index 0
                                });

                                // 3. แพ็ครวมส่งให้ ESP32 (เช่น "02:00:10;empty;22:00:10")
                                const scheduleString = scheduleArray.join(';');

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

                    console.log(`📱 ESP32 added/updated schedule: Slot ${slot} -> ${feedTime} - ${feedAmount}g`);

                    try {
                        const timeForDB = `${feedTime}:00`;

                        // 🌟 แก้ตรงนี้: ค้นหาด้วยคำว่า "slot" ไม่ใช่ "feedTime"
                        const [existing] = await db.promise().query(
                            'SELECT * FROM feedconfig WHERE feederID = ? AND slot = ?',
                            [targetFeeder, slot]
                        );

                        if (existing.length === 0) {
                            // ถ้ายังไม่มี Round นี้ ให้ Insert เข้าไปใหม่
                            await db.promise().query(
                                'INSERT INTO feedconfig (feederID, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?)',
                                [targetFeeder, timeForDB, feedAmount, slot]
                            );
                            console.log(`✅ ESP32 Schedule INSERTED to Web DB`);
                        } else {
                            // 🌟 ถ้ามี Round นี้อยู่แล้ว ให้ UPDATE เวลาและปริมาณอาหารทับไปเลย!
                            await db.promise().query(
                                'UPDATE feedconfig SET feedTime = ?, feedAmount = ? WHERE feederID = ? AND slot = ?',
                                [timeForDB, feedAmount, targetFeeder, slot]
                            );
                            console.log(`✅ ESP32 Schedule UPDATED in Web DB`);
                        }
                    } catch (err) {
                        console.error('❌ Error saving ESP32 schedule:', err.message);
                    }
                }

                // ===== 4. Handle Delete Schedule from ESP32 =====
                if (data.type === 'delete_schedule_from_esp') {
                    const targetFeeder = myFeederID;
                    const slot = data.slot; // 🌟 รับค่า slot มาใช้เลย

                    console.log(`📱 ESP32 deleted schedule at Slot: ${slot}`);

                    try {
                        // 🌟 แก้ตรงนี้: สั่งลบจาก slot ชัวร์ที่สุด ไม่ผิดตัวแน่นอน
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE feederID = ? AND slot = ?',
                            [targetFeeder, slot]
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
                               // 1. ลบตารางเวลา
                               await db.promise().query('DELETE FROM feedconfig WHERE feederID = ?', [myFeederID]);
                               // 2. ลบประวัติ
                               await db.promise().query('DELETE FROM feedlogs WHERE feederID = ?', [myFeederID]);
                               // 3. ลบ Dashboard ที่ผูกอยู่
                               await db.promise().query('DELETE FROM dashboards WHERE feederID = ?', [myFeederID]);
                               
                               // 🌟 4. ลบข้อมูลเครื่อง (และ Token เก่า) ออกจากระบบถาวร!
                               await db.promise().query('DELETE FROM petfeeders WHERE feederID = ?', [myFeederID]);

                               // 🌟 5. แจ้งเตือนหน้าเว็บ (ถ้าเปิดค้างไว้) ให้เด้งออกไปที่หน้า Index
                               if (viewers.has(myFeederID)) {
                                    viewers.get(myFeederID).forEach(viewer => {
                                        if (viewer.readyState === WebSocket.OPEN) {
                                            viewer.send(JSON.stringify({
                                                type: 'factory_reset_kick'
                                            }));
                                        }
                                    });
                               }

                               console.log(`✅ Factory Reset completed. Token deleted for Feeder ${myFeederID}`);
                          } catch (err) {
                               console.error(`❌ Error during Factory Reset:`, err.message);
                          }
                     }
                }

                // ===== 5. Handle Full Sync Schedule from ESP32 =====
                if (data.type === 'sync_schedule_from_esp') {
                    let targetFeeder = myFeederID;
                    
                    try {
                        // 🌟 ป้องกันปัญหา Race Condition: ถ้า myFeederID ยังเป็น null (Register คุยกับ DB ไม่ทัน) ให้ดึงจาก Token แทน
                        if (!targetFeeder && data.token) {
                            const [rows] = await db.promise().query('SELECT feederID FROM petfeeders WHERE feederToken = ?', [data.token]);
                            if (rows.length > 0) {
                                targetFeeder = rows[0].feederID;
                                myFeederID = targetFeeder; // อัปเดตตัวแปรหลักให้ถูกต้องเพื่อใช้ในอนาคต
                            } else {
                                console.log('❌ Sync error: Token not found in Database');
                                return; // หยุดการทำงานถ้าไม่เจอ Token
                            }
                        }

                        const rawSchedule = data.raw; // จะมาเป็น "08:00:50;empty;18:30:100"
                        console.log(`📱 ESP32 Offline Sync: Full sync requested for Feeder ${targetFeeder}`);
                        
                        // 1. ลบตารางเวลาเก่าของเครื่องนี้ทิ้งให้หมดก่อน (เพื่อเคลียร์ของเดิม)
                        await db.promise().query(
                            'DELETE FROM feedconfig WHERE feederID = ?',
                            [targetFeeder]
                        );

                        // 2. ถ้าไม่ได้ส่งว่างๆ มา ก็ให้แตกข้อมูลออกมา Insert ใหม่
                        if (rawSchedule && rawSchedule.length > 0) {
                            const slots = rawSchedule.split(';');
                            
                            for (let i = 0; i < slots.length; i++) {
                                if (slots[i] !== 'empty' && slots[i].length > 0) {
                                    // แตกข้อมูล "08:00:50" ออกมา
                                    const parts = slots[i].split(':');
                                    if (parts.length === 3) {
                                        const timeForDB = `${parts[0]}:${parts[1]}:00`;
                                        const feedAmount = parseInt(parts[2]);
                                        const slotNumber = i + 1;

                                        // เอาไปยัดใส่ฐานข้อมูล
                                        await db.promise().query(
                                            'INSERT INTO feedconfig (feederID, feedTime, feedAmount, slot) VALUES (?, ?, ?, ?)',
                                            [targetFeeder, timeForDB, feedAmount, slotNumber]
                                        );
                                    }
                                }
                            }
                        }
                        
                        console.log(`✅ ESP32 Offline Schedule synced completely!`);

                        // 3. สั่งให้หน้าเว็บรีเฟรชตารางเวลาอัตโนมัติ
                        if (viewers.has(targetFeeder)) {
                            viewers.get(targetFeeder).forEach(viewer => {
                                if (viewer.readyState === 1) { 
                                    viewer.send(JSON.stringify({ type: 'force_reload' }));
                                }
                            });
                        }

                    } catch (err) {
                        console.error('❌ Error syncing offline schedule from ESP32:', err.message);
                    }
                }

                // ===== 6. Handle Request Schedule from ESP32 (เมื่อเครื่องออนไลน์กลับมา) =====
                if (data.type === 'request_schedule') {
                    let targetFeeder = myFeederID;
                    
                    try {
                        // 🌟 ดัก Race Condition แบบเดิม เผื่อ Register ทำงานไม่ทัน
                        if (!targetFeeder && data.token) {
                            const [rows] = await db.promise().query('SELECT feederID FROM petfeeders WHERE feederToken = ?', [data.token]);
                            if (rows.length > 0) {
                                targetFeeder = rows[0].feederID;
                                myFeederID = targetFeeder;
                            } else {
                                return;
                            }
                        }

                        console.log(`📥 ESP32 requested schedule on boot/reconnect for Feeder ${targetFeeder}`);

                        // 1. ดึงตารางเวลาล่าสุดของเครื่องนี้จากฐานข้อมูล
                        const [schedules] = await db.promise().query(
                            'SELECT feedTime, feedAmount, slot FROM feedconfig WHERE feederID = ?',
                            [targetFeeder]
                        );

                        // 2. สร้างกล่องเปล่า 3 ใบรอไว้
                        let scheduleArray = ['empty', 'empty', 'empty'];

                        // 3. เอาเวลาจาก DB มาจัดลงกล่องให้ตรงช่อง (Slot)
                        schedules.forEach(sc => {
                            if (sc.slot >= 1 && sc.slot <= 3) {
                                const [hour, minute] = sc.feedTime.split(':');
                                scheduleArray[sc.slot - 1] = `${hour}:${minute}:${sc.feedAmount}`;
                            }
                        });

                        // 4. ประกอบร่าง (เช่น "08:00:50;empty;18:30:100")
                        const scheduleString = scheduleArray.join(';');

                        // 5. ส่งกลับไปให้ ESP32
                        if (feeders.has(targetFeeder)) {
                            const espWs = feeders.get(targetFeeder);
                            if (espWs && espWs.readyState === 1 /* WebSocket.OPEN */) {
                                espWs.send(JSON.stringify({
                                    type: 'schedule_update',
                                    raw: scheduleString
                                }));
                                console.log(`📤 Sent requested schedule back to ESP32: ${scheduleString}`);
                            }
                        }

                    } catch (err) {
                        console.error('❌ Error sending requested schedule:', err.message);
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