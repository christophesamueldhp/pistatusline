import { runTUI } from '../tui/App';
import { initConfigPath } from '../utils/config';

import {
    readState,
    writeState
} from './state';

const ENTER_ALTERNATE_SCREEN = '\x1b[?1049h';
const LEAVE_ALTERNATE_SCREEN = '\x1b[?1049l';

const [configPath, statePath] = process.argv.slice(2);
if (!configPath || !statePath) {
    process.stderr.write('usage: tui-cli <settings.json> <state.json>\n');
    process.exit(2);
}

process.stdout.write(ENTER_ALTERNATE_SCREEN);
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
    process.stdout.write(LEAVE_ALTERNATE_SCREEN);
}
