/**
 * DEMO FIXTURES — the CONTROL grid, standing in for `GET /config`
 * (services/deviceinfo/buttons.json).
 *
 * Icon filenames are existing files in public/icons, referenced as PLAIN
 * RUNTIME STRINGS -- never ES-module asset imports, which blank-screen the
 * Chromium 69 kiosk.
 */

import type { ButtonConfig } from '../components/ControlSlot'

export const DEMO_BUTTONS: ButtonConfig[] = [
  {
    // expectedModel matches the demo router's `loaded` id -> renders ACTIVE.
    id: 'demo-qwen-coder',
    displayName: 'Qwen3 Coder',
    subLabel: '30B',
    kind: 'model',
    expectedModel: 'qwen3-coder-30b',
    requiresRouter: true,
    confirm: true,
    icons: { active: 'icon_qwen35_35b_active.png', inactive: 'icon_qwen35_35b_off.png' },
  },
  {
    id: 'demo-mistral',
    displayName: 'Mistral',
    subLabel: '24B',
    kind: 'model',
    expectedModel: 'mistral-small-24b',
    requiresRouter: true,
    confirm: true,
    icons: { active: 'icon_glm_active.png', inactive: 'icon_glm_off.png' },
  },
  {
    id: 'demo-llama',
    displayName: 'Llama 3.1',
    subLabel: '8B',
    kind: 'model',
    expectedModel: 'llama-3.1-8b',
    requiresRouter: true,
    confirm: true,
    icons: { active: 'icon_seedcoder_active.png', inactive: 'icon_seedcoder_off.png' },
  },
  {
    id: 'demo-unload',
    displayName: 'Unload',
    kind: 'action',
    requiresRouter: true,
    requiresLoadedModel: true,
    confirm: true,
    icons: { active: 'icon_kill_active.png', inactive: 'icon_kill_off.png' },
  },
  {
    id: 'demo-router',
    displayName: 'Router',
    kind: 'toggle',
    icons: { active: 'icon_router_active.png', inactive: 'icon_router_off.png' },
  },
]
