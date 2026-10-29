import { initializeApp } from "https://gstatic.com";
import { getDatabase, ref, set, get, update } from "https://gstatic.com";

// ดึงคีย์ลับจากตัวแปรระบบหลังบ้าน (Environment Variables) ของ Vercel
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

export default async function handler(req, res) {
    // 🛠️ 1. [การันตี CORS ผ่านแน่]: ส่งค่า Headers ออกไปตั้งแต่บรรทัดแรกสุดของตัวฟังก์ชัน
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Content-Type');

    // 🛠️ 2. ดักจับและตอบกลับ Preflight Request (OPTIONS) ทันทีโดยไม่ต้องรัน Logic ด้านล่าง
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 🛠️ 3. ย้ายการเปิดใช้งานเซิร์ฟเวอร์ Firebase เข้ามาอยู่ในตัวฟังก์ชันเพื่อป้องกันระบบแคชของ Serverless ค้าง
    let app, db;
    try {
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
    } catch (firebaseErr) {
        console.error("Firebase Initialization Failed:", firebaseErr);
        return res.status(500).json({ error: "เซิร์ฟเวอร์ฐานข้อมูลหลังบ้านทำงานขัดข้อง" });
    }

    // ทำการตรวจสอบและแปลงข้อมูลข้อมูลนำเข้าจากหน้าบ้านป้องกันการส่งข้อมูลหลุดรูปแบบ
    let bodyData = req.body;
    if (typeof bodyData === 'string') {
        try {
            bodyData = JSON.parse(bodyData);
        } catch (e) {
            return res.status(400).json({ error: "รูปแบบ JSON ไม่ถูกต้อง" });
        }
    }

    const { action, roomId, playerName, selectedClues, tileId, option } = bodyData;

    if (!roomId) return res.status(400).json({ error: "ไม่พบข้อมูลหมายเลขรหัสห้อง (Missing roomId)" });
    const roomRef = ref(db, 'csfiles_rooms/' + roomId);

    try {
        // เงื่อนไขในการสร้างหรือเข้าห้องเกมออนไลน์
        if (action === 'join') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();

            if (!data) {
                // ถ้ายังไม่มีห้อง ให้สร้างห้องใหม่ (คนแรกเป็นโฮสต์/นักพิสูจน์หลักฐาน)
                const initialRoom = {
                    status: "lobby",
                    forensic: playerName, 
                    murderer: "", 
                    targetWeapon: "", 
                    targetClue: "",
                    selections: { location: "", cause: "", body: "", motive: "" },
                    players: { [playerName]: "waiting" }
                };
                await set(roomRef, initialRoom);
                return res.status(200).json({ success: true });
            } else {
                // ถ้ามีห้องอยู่แล้ว ให้เพิ่มชื่อผู้เล่นใหม่เข้าไปในรายชื่อห้องเดิม
                await update(ref(db, `csfiles_rooms/${roomId}/players`), { [playerName]: "waiting" });
                return res.status(200).json({ success: true });
            }
        }

        // ฟังก์ชันดึงสถานะห้องทั้งหมดกลับไปให้หน้าบ้านรันหน้าจอ
        if (action === 'getRoom') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (!data) {
                return res.status(200).json({ status: "none" });
            }
            return res.status(200).json(data);
        }

        // ฟังก์ชันกดเริ่มเกมจากหน้า Lobby ของหัวห้อง
        if (action === 'startGame') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (data) {
                let playersUpdate = {};
                const playerNames = Object.keys(data.players);
                
                // สุ่มเลือก 1 คนเป็นฆาตกร (ไม่เอาคนที่เป็นนักพิสูจน์หลักฐาน)
                let murdererName = playerNames.find(p => p !== data.forensic) || playerNames[0];
                
                playerNames.forEach(p => {
                    playersUpdate[p] = {
                        role: p === murdererName ? "murderer" : (p === data.forensic ? "forensic" : "investigator"),
                        weapons: ["มีดปลอกผลไม้", "ยาพิษ", "ปืนพก", "เชือกผ้า"],
                        clues: ["รอยเลือด", "จดหมาย", "เส้นผม", "ไดอารี่"]
                    };
                });

                await update(ref(db, `csfiles_rooms/${roomId}`), {
                    status: "playing",
                    murderer: murdererName,
                    weapon: "มีดปลอกผลไม้",
                    clue: "รอยเลือด",
                    players: playersUpdate
                });
            }
            return res.status(200).json({ success: true });
        }

        // ฟังก์ชันสำหรับการกดเลือกคำใบ้บนกระดานชันสูตรสำหรับ Forensic
        if (action === 'selectTile') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), { [tileId]: option });
            return res.status(200).json({ success: true });
        }

        // ฟังก์ชันระบบรีเซ็ตคดีใหม่กลับสู่ค่าเริ่มต้น
        if (action === 'resetGame') {
            await set(roomRef, null);
            return res.status(200).json({ success: true });
        }

        // ระบบส่งข้อมูลคำใบ้เพิ่มเติมของตัวเกม
        if (action === 'updateClues') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), selectedClues);
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Invalid action" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
