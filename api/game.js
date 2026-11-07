import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, set, get, update } from "firebase/database";

const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID
};

// 🎯 คลังคำศัพท์บอร์ดเกม CS-Files มาตรฐานสากลสำหรับสุ่มแจกการ์ดผู้เล่น
const WEAPONS_POOL = [
    "มีดปลอกผลไม้", "ยาพิษ", "ปืนพก", "เชือกผ้า", "ค้อนเหล็ก", 
    "ไม้หน้าสาม", "สายไฟ", "หมอนหนุน", "อิฐบล็อก", "ขวานจาม",
    "เศษแก้ว", "ของมีคม", "น้ำยาล้างห้องน้ำ", "กระแสไฟฟ้า", "กรรไกรตัดผ้า",
    "ประแจคอม้า", "ลูกซองจู่โจม", "คัตเตอร์", "ท่อเหล็ก", "สารเคมี"
];

const CLUES_POOL = [
    "รอยเลือด", "จดหมาย", "เส้นผม", "ไดอารี่", "นาฬิกาข้อมือ", 
    "แหวนทอง", "ลิปสติก", "ขวดเหล้า", "ก้นบุหรี่", "แก้วกาแฟ",
    "ตั๋วรถไฟ", "ผ้าเช็ดหน้า", "รูปถ่าย", "แว่นตา", "หน้ากากอนามัย",
    "พวงกุญแจ", "กระเป๋าสตางค์", "ถุงมือยาง", "เศษดิน", "รอยเท้า"
];

// ฟังก์ชันสำหรับสุ่มหยิบการ์ดจากคลังคำศัพท์แบบไม่ซ้ำกัน
function getRandomItems(pool, count) {
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    let app, db;
    try {
        app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
        db = getDatabase(app);
    } catch (firebaseErr) {
        console.error("Firebase Init Crash:", firebaseErr);
        return res.status(200).json({ error: "ฐานข้อมูลหลังบ้านไม่ตอบสนอง แต่ด่าน CORS ผ่านฉลุย" });
    }

    let bodyData = req.body;
    if (typeof bodyData === 'string' && bodyData.trim() !== '') {
        try {
            bodyData = JSON.parse(bodyData);
        } catch (e) {}
    }

    if (!bodyData) bodyData = {};
    const { action, roomId, playerName, tileId, option } = bodyData;

    if (!roomId) return res.status(200).json({ error: "Missing roomId" });
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
                    weapon: "", 
                    clue: "",
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
            if (!data) return res.status(200).json({ status: "none" });
            return res.status(200).json(data);
        }

        if (action === 'startGame') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (data) {
                let playersUpdate = {};
                const playerNames = Object.keys(data.players);
                
                // 1. สุ่มเลือกผู้เล่น 1 คนให้มารับบทเป็นฆาตกร (หลีกเลี่ยงคนที่เป็นคนชันสูตรหลักฐาน)
                let murdererName = playerNames.find(p => p !== data.forensic) || playerNames[0];
                
                let selectedWeapon = "";
                let selectedClue = "";

                // 2. ลูปแจกแจงการ์ดแบบสุ่มคำศัพท์ไม่ซ้ำกันให้เจ้าหน้าที่สืบสวนแต่ละนาย
                playerNames.forEach(p => {
                    const assignedWeapons = getRandomItems(WEAPONS_POOL, 4);
                    const assignedClues = getRandomItems(CLUES_POOL, 4);

                    // เก็บเป้าหมายคดีหลักฐานลับของฆาตกรที่สุ่มได้จากการ์ดในมือของฆาตกรคนนั้น
                    if (p === murdererName) {
                        selectedWeapon = assignedWeapons[0];
                        selectedClue = assignedClues[0];
                    }

                    playersUpdate[p] = {
                        role: p === murdererName ? "murderer" : (p === data.forensic ? "forensic" : "investigator"),
                        weapons: assignedWeapons,
                        clues: assignedClues
                    };
                });

                // 3. บันทึกข้อมูลคดีหลักฐานลับลงในฐานข้อมูล Firebase
                await update(ref(db, `csfiles_rooms/${roomId}`), {
                    status: "playing",
                    murderer: murdererName,
                    weapon: selectedWeapon,
                    clue: selectedClue,
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

        return res.status(200).json({ status: "ok" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
