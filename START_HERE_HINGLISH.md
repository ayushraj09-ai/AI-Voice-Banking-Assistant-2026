# Voice Banking Assistant — Start Here (Hinglish)

## Windows par chalane ka easiest tareeka
1. ZIP ko ek nayi folder mein extract karo (purane project ke upar extract mat karo).
2. Extracted `voice-banking-assistant` folder kholo.
3. `START_APP.bat` par double-click karo.
4. Jo black terminal window khule, use band mat karna.
5. Browser mein `http://localhost:3000` open hoga.

`START_APP.bat` port 3000 par chal rahe purane server ko band karta hai aur isi extracted folder ka server start karta hai. Isse galti se purana code run hone ka chance kam hota hai.

## Agar app pehle se chal rahi ho
Purani server terminal window mein `Ctrl+C` dabao, phir extracted folder ke `START_APP.bat` ko double-click karo.

## Demo login
- Username: `ashish2604`
- Password: `ashish2604`
- Demo PIN: `5678`

Use sirf academic demo ke liye karo. Real bank account ya real credentials use mat karo.

## Tests
Project folder mein terminal kholo aur run karo:
```powershell
npm test
```

## Important status
Automated smoke tests cover the implemented routes and basic flows, but real Windows browser/microphone flow and dedicated anti-spoofing model integration still need end-to-end validation. Is project ko production banking security ke liye use mat karna.


## Pehli baar setup

`START_APP.bat` par double-click karein. Agar Python environment nahi hai, launcher `ml\setup_windows.ps1` ko automatically chalane ki koshish karega. Pehli baar internet zaroori hai aur PyTorch/model dependencies download hone ki wajah se kaafi waqt lag sakta hai. Setup ke dauran window band na karein. Setup fail ho to screen par aaya exact error dekhein.
