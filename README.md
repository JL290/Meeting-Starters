# Tap Sprint 🏁

A party game: everyone scans a QR code, taps their own phone as fast as they
can, and the first runner across the line wins. No sign-in, no app, no
dependencies (just Node 18+).

## How to play
1. Open the site on a big screen (laptop/TV) and tap **Host on the big screen**.
2. Everyone else scans the QR code (or types the 4-letter room code at the site).
3. Players enter a name and tap **I'm in**.
4. Host taps **Start race**. After 3-2-1-GO, tap, tap, tap!

## Run it on your own computer (same Wi-Fi)
    node server.js
Open http://localhost:3000 on the host screen. Phones on the same Wi-Fi can't
use "localhost", so open http://YOUR-COMPUTER-IP:3000 on the host screen
instead (e.g. http://192.168.1.20:3000) and the QR code will point phones
to the right address.

## Put it online for free (Render)
1. Create a free GitHub account and a new repository, then upload every file
   in this folder (keep the `public` folder).
2. Sign up at https://render.com (free), choose New > Web Service, and
   connect that repository.
3. Settings: Runtime = Node, Build Command = (leave empty), Start Command =
   `node server.js`, Instance type = Free. (Or choose New > Blueprint, and
   Render reads `render.yaml` for you.)
4. Click Deploy. In a minute or two you get an address like
   https://tap-sprint-xxxx.onrender.com. Open it on the big screen.

Note: Render's free tier sleeps after ~15 minutes idle, so the first load can
take about 30 seconds. Open the site a minute before your party.

Other hosts that work the same way: Railway, Fly.io, Glitch, Koyeb, or any
VPS with Node. The server reads the `PORT` environment variable.

## How it works
- `server.js` serves the page and runs the race. It keeps rooms in memory,
  runs the countdown, and decides the winner. Phones send their progress with
  small POST requests, and everyone receives live updates over Server-Sent
  Events.
- `public/index.html` is the whole game (host screen and phone controller).
- The QR code image is generated in the browser by the qrcode-generator
  library from cdnjs, so the host screen needs internet access.
