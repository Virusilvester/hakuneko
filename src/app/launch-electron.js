const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), {
    env,
    stdio: 'inherit',
    windowsHide: false
});

child.on('close', (code, signal) => {
    if(signal) {
        console.error(electron, 'exited with signal', signal);
        process.exit(1);
    }
    process.exit(code);
});

for(let signal of ['SIGINT', 'SIGTERM', 'SIGUSR2']) {
    process.on(signal, () => {
        child.kill(signal);
    });
}
