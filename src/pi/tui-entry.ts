// Separate bundle: Ink/React/yoga load only when /pistatusline opens the editor.
import {
    runTUI,
    type PiStatuslineHost
} from '../tui/App';
import { initConfigPath } from '../utils/config';

export type { PiStatuslineHost };

export async function runEditor(host: PiStatuslineHost, configPath: string): Promise<void> {
    initConfigPath(configPath);
    await runTUI(host);
}
