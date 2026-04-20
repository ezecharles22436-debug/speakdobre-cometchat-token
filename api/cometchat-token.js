module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { uid, name } = req.body || {};

    if (!uid) {
      return res.status(400).json({ error: "Missing uid" });
    }

    const APP_ID = "1677376866e3f736f";
    const REGION = "eu";
    const API_KEY = process.env.COMETCHAT_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({ error: "Missing COMETCHAT_API_KEY" });
    }

    await fetch(`https://${APP_ID}.api-${REGION}.cometchat.io/v3/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: API_KEY
      },
      body: JSON.stringify({
        uid: uid,
        name: name || uid
      })
    });

    const tokenRes = await fetch(
      `https://${APP_ID}.api-${REGION}.cometchat.io/v3/users/${uid}/auth_tokens`,
      {
        method: "POST",
        headers: {
          apikey: API_KEY
        }
      }
    );

    const tokenData = await tokenRes.json();

    return res.status(200).json({
      token: tokenData?.data?.authToken || null,
      raw: tokenData
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
};
