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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export default async function handler(req, res) {
    // 🛠️ 1. ตั้งค่า CORS ปลดล็อกเสรีให้หน้าบ้านเรียกใช้งานได้อย่างถูกต้อง
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Content-Type');

    // 🛠️ 2. ปลดล็อกด่านแรก (Preflight) ให้เบราว์เซอร์ผ่านฉลุย
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // ทำการตรวจสอบและแปลงข้อมูล Body ป้องกันกรณีข้อมูลส่งมาเป็น String
    let bodyData = req.body;
    if (typeof bodyData === 'string') {
        try {
            bodyData = JSON.parse(bodyData);
        } catch (e) {
            return res.status(400).json({ error: "Invalid JSON body" });
        }
    }

    const { action, roomId, playerName, selectedClues, tileId, option } = bodyData;

    if (!roomId) return res.status(400).json({ error: "Missing roomId" });
    const roomRef = ref(db, 'csfiles_rooms/' + roomId);

    try {
        // [แก้ไขเพิ่มเติม]: ระบบสร้างหรือเข้าห้องเกม
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

        // 🛠️ [จุดที่ขาดหายไปอันดับ 1]: ฟังก์ชันส่งข้อมูลห้องทั้งหมดกลับไปให้หน้าบ้านรัน syncGame
        if (action === 'getRoom') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (!data) {
                return res.status(200).json({ status: "none" });
            }
            return res.status(200).json(data);
        }

        // 🛠️ [จุดที่ขาดหายไปอันดับ 2]: ฟังก์ชันกดเริ่มเกมจากหน้า Lobby
        if (action === 'startGame') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (data) {
                // สุ่มแจกบทบาทและอาวุธเบื้องต้นให้กับผู้เล่นใน Firebase
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
                    weapon: "มีดปลอกผลไม้", // ตัวอย่างการล็อกหลักฐานคดี
                    clue: "รอยเลือด",
                    players: playersUpdate
                });
            }
            return res.status(200).json({ success: true });
        }

        // 🛠️ [จุดที่ขาดหายไปอันดับ 3]: ฟังก์ชันสำหรับการกดเลือกคำใบ้บนกระดานชันสูตร
        if (action === 'selectTile') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), { [tileId]: option });
            return res.status(200).json({ success: true });
        }

        // ฟังก์ชันระบบรีเซ็ตคดีใหม่
        if (action === 'resetGame') {
            await set(roomRef, null);
            return res.status(200).json({ success: true });
        }

        // ระบบสำหรับส่งข้อมูลคำใบ้เพิ่มเติม (เผื่อขยายสิทธิ์)
        if (action === 'updateClues') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), selectedClues);
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Invalid action" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
