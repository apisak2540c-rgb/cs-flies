import { initializeApp } from "https://gstatic.com";
import { getDatabase, ref, set, get, update } from "https://gstatic.com";

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
    // 🛠️ ปลดล็อกด่านเครือข่าย CORS ส่งเป็นลำดับแรกสุดตามกฎของ Vercel Gateway
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    // 🛠️ ตัดการทำงานและส่งสถานะ 200 OK กลับไปทันทีเมื่อเบราว์เซอร์ส่งคำขอแบบ OPTIONS (Preflight) เข้ามาเช็กระบบ
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    let app, db;
    try {
        app = initializeApp(firebaseConfig);
        db = getDatabase(app);
    } catch (firebaseErr) {
        console.error("Firebase Initialization Failed:", firebaseErr);
        return res.status(500).json({ error: "เซิร์ฟเวอร์ฐานข้อมูลหลังบ้านทำงานขัดข้อง" });
    }

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
        if (action === 'join') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();

            if (!data) {
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
                await update(ref(db, `csfiles_rooms/${roomId}/players`), { [playerName]: "waiting" });
                return res.status(200).json({ success: true });
            }
        }

        if (action === 'getRoom') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (!data) {
                return res.status(200).json({ status: "none" });
            }
            return res.status(200).json(data);
        }

        if (action === 'startGame') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (data) {
                let playersUpdate = {};
                const playerNames = Object.keys(data.players);
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

        if (action === 'selectTile') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), { [tileId]: option });
            return res.status(200).json({ success: true });
        }

        if (action === 'resetGame') {
            await set(roomRef, null);
            return res.status(200).json({ success: true });
        }

        if (action === 'updateClues') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), selectedClues);
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Invalid action" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
