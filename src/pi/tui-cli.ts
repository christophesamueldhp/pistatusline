// The editor runs as its own process, as ccstatusline's does (`npx ccstatusline`): pi hands it
// the terminal and waits. Usage: node tui-cli.js <settings.json> <state.json>
import { runTUI } from '../tui/App';
import { initConfigPath } from '../utils/config';

import {
    readState,
    writeState
} from './state';

const [configPath, statePath] = process.argv.slice(2);
if (!configPath || !statePath) {
    process.stderr.write('usage: tui-cli <settings.json> <state.json>\n');
    process.exit(2);
}

// Draw on the alternate screen, like an external editor, so pi's screen is intact on exit.
process.stdout.write('\x1b[?1049h');
initConfigPath(configPath);
let state = readState(statePath);
try {
    await runTUI({
        isEnabled: () => state.enabled,
        setEnabled: (enabled) => {
            state = { ...state, enabled };
            writeState(statePath, state);
            return Promise.resolve();
        },
        getRefreshInterval: () => state.refreshInterval,
        setRefreshInterval: (seconds) => {
            state = { ...state, refreshInterval: seconds };
            writeState(statePath, state);
            return Promise.resolve();
        }
    });
} finally {
    process.stdout.write('\x1b[?1049l');
}
// Ink can leave stdin handles open after unmount; the process has nothing else to do.
process.exit(0);
