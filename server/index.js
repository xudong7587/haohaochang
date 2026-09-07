import { createApp } from './app.js';
const {app} = createApp();
const port=Number(process.env.PORT || 3210);
app.listen(port,'0.0.0.0',()=>console.log(`好好唱已启动：http://localhost:${port}`));
