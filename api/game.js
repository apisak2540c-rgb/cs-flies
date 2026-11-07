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

const WEAPONS_POOL = ["มีดปลอกผลไม้", "ยาพิษ", "ปืนพก", "เชือกผ้า", "ค้อนเหล็ก", "ไม้หน้าสาม", "สายไฟ", "หมอนหนุน", "อิฐบล็อก", "ขวานจาม"];
const CLUES_POOL = ["รอยเลือด", "จดหมาย", "เส้นผม", "ไดอารี่", "นาฬิกาข้อมือ", "แหวนทอง", "ลิปสติก", "ขวดเหล้า", "ก้นบุหรี่", "แก้วกาแฟ"];

function getRandomItems(pool, count) {
    return [...pool].sort(() => 0.5 - Math.random()).slice(0, count);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') return res.status(200).end();

    let bodyData = req.body;
    if (typeof bodyData === 'string' && bodyData.trim() !== '') {
        try { bodyData = JSON.parse(bodyData); } catch (e) {}
    }

    if (!bodyData) bodyData = {};
    const { action, roomId, playerName, weapon, clue, tileId, option, targetPlayer, accusedWeapon, accusedClue } = bodyData;

    if (!roomId) return res.status(200).json({ error: "Missing roomId" });
    const roomRef = ref(db, 'csfiles_rooms/' + roomId);

    let app, db;
    try {
        app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
        db = getDatabase(app);
    } catch (err) {
        return res.status(200).json({ error: "Database Connection Error" });
    }

    try {
        if (action === 'join') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (!data) {
                const initialRoom = {
                    status: "lobby", forensic: playerName, murderer: "", weapon: "", clue: "", winner: "",
                    selections: { location: "", cause: "", body: "", motive: "" },
                    players: { [playerName]: { status: "waiting", hasAccused: false } }
                };
                await set(roomRef, initialRoom);
            } else {
                await update(ref(db, `csfiles_rooms/${roomId}/players`), { [playerName]: { status: "waiting", hasAccused: false } });
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'getRoom') {
            const snapshot = await get(roomRef);
            return res.status(200).json(snapshot.val() || { status: "none" });
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
                        weapons: getRandomItems(WEAPONS_POOL, 4),
                        clues: getRandomItems(CLUES_POOL, 4),
                        hasAccused: false
                    };
                });

                await update(ref(db, `csfiles_rooms/${roomId}`), {
                    status: "murderer_select",
                    murderer: murdererName,
                    players: playersUpdate
                });
            }
            return res.status(200).json({ success: true });
        }

        // 🛠️ ฆาตกรส่งหลักฐานและอาวุธที่แอบเลือกใช้ก่อคดี
        if (action === 'selectCrime') {
            await update(ref(db, `csfiles_rooms/${roomId}`), {
                weapon: weapon,
                clue: clue,
                status: "playing"
            });
            return res.status(200).json({ success: true });
        }

        // 🛠️ นักพิสูจน์หลักฐานกดปักหมุดกระดานชันสูตร
        if (action === 'selectTile') {
            await update(ref(db, `csfiles_rooms/${roomId}/selections`), { [tileId]: option });
            return res.status(200).json({ success: true });
        }

        // 🛠️ ระบบกดส่งคำขอจับกุมคดี ตรวจสอบเงื่อนไขแพ้-ชนะแบบสากล
        if (action === 'accuse') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();
            if (data && data.status === "playing") {
                await update(ref(db, `csfiles_rooms/${roomId}/players/${playerName}`), { hasAccused: true });
                
                // ตรวจสอบกฎเหล็ก: ชี้ตัว [ฆาตกร + อาวุธ + หลักฐาน] ถูกต้องพร้อมกันเป๊ะๆ ทั้ง 3 อย่าง
                if (targetPlayer === data.murderer && accusedWeapon === data.weapon && accusedClue === data.clue) {
                    await update(ref(db, `csfiles_rooms/${roomId}`), { status: "ended", winner: "investigators" });
                } else {
                    // ตรวจสอบเช็กว่าสิทธิ์การจับกุมของนักสืบทุกคนหมดลงแล้วหรือยัง
                    const players = data.players;
                    players[playerName].hasAccused = true;
                    const investigators = Object.keys(players).filter(p => p !== data.forensic);
                    const allFailed = investigators.every(p => players[p].hasAccused === true);
                    
                    if (allFailed) {
                        await update(ref(db, `csfiles_rooms/${roomId}`), { status: "ended", winner: "murderer" });
                    }
                }
            }
            return res.status(200).json({ success: true });
        }

        if (action === 'resetGame') {
            await set(roomRef, null);
            return res.status(200).json({ success: true });
        }
        return res.status(200).json({ status: "ok" });
    } catch (error) {
        return res.status(200).json({ error: error.message });
    }
}
