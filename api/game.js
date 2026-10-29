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
    // ตั้งค่า CORS เพื่ออนุญาตให้เฉพาะเว็บ github.io ของคุณเรียกใช้งานได้เท่านั้น
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { action, roomId, playerName, selectedClues } = req.body;

    if (!roomId) return res.status(400).json({ error: "Missing roomId" });
    const roomRef = ref(db, 'csfiles_rooms/' + roomId);

    try {
        // 1. ระบบสร้างหรือเข้าห้องเกม
        if (action === 'join') {
            const snapshot = await get(roomRef);
            const data = snapshot.val();

            if (!data) {
                // ถ้ายังไม่มีห้อง ให้สร้างห้องใหม่ (คนแรกเป็นโฮสต์)
                const initialRoom = {
                    status: "lobby", forensic: "", murderer: "", targetWeapon: "", targetClue: "",
                    selectedClues: { location: "", cause: "", body: "", motive: "" },
                    players: { [playerName]: "waiting" }
                };
                await set(roomRef, initialRoom);
                return res.status(200).json({ status: "lobby", isHost: true });
            } else {
                // ถ้ามีห้องอยู่แล้ว ให้เพิ่มชื่อผู้เล่นใหม่เข้าไป
                await update(ref(db, `csfiles_rooms/${roomId}/players`), { [playerName]: "waiting" });
                return res.status(200).json({ status: data.status, isHost: false });
            }
        }

        // 2. ระบบสำหรับหัวหน้านักสืบส่งคำใบ้ชันสูตร
        if (action === 'updateClues') {
            await update(ref(db, `csfiles_rooms/${roomId}/selectedClues`), selectedClues);
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: "Invalid action" });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
