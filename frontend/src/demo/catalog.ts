// Generated from backend/core/permissions.py and the integration manifests + services.yaml (backend/modules/integrations/*).
// Not hand-edited; regenerate from those sources if they change.
import type { IntegrationSchemasResponse, PermissionCatalog } from '../types/api';

export const PERMISSION_CATALOG: PermissionCatalog = {
  "permissions": [
    {
      "name": "integrations:read",
      "group": "Integrations",
      "description": "View integrations and their state"
    },
    {
      "name": "integrations:edit",
      "group": "Integrations",
      "description": "Create, edit and delete integrations"
    },
    {
      "name": "vfx:control",
      "group": "Integrations",
      "description": "Call lighting integrations (ZerOS, OSC, WLED, Art-Net)"
    },
    {
      "name": "video:control",
      "group": "Integrations",
      "description": "Call video integrations (OBS, ATEM, PTZ cameras)"
    },
    {
      "name": "audio:control",
      "group": "Integrations",
      "description": "Call audio integrations (Spotify)"
    },
    {
      "name": "tm:control",
      "group": "Integrations",
      "description": "Call Tournament Manager services"
    },
    {
      "name": "capture:control",
      "group": "Integrations",
      "description": "Start, stop and mark recordings; send replays to program"
    },
    {
      "name": "automations:read",
      "group": "Automations",
      "description": "View automations, scripts and folders"
    },
    {
      "name": "automations:edit",
      "group": "Automations",
      "description": "Create, edit and delete automations"
    },
    {
      "name": "automations:trigger",
      "group": "Automations",
      "description": "Run automations by hand"
    },
    {
      "name": "buttons:read",
      "group": "Automations",
      "description": "View button pages"
    },
    {
      "name": "buttons:press",
      "group": "Automations",
      "description": "Press buttons"
    },
    {
      "name": "buttons:manage",
      "group": "Automations",
      "description": "Create and edit button pages"
    },
    {
      "name": "timers:read",
      "group": "Event",
      "description": "View timers"
    },
    {
      "name": "timers:edit",
      "group": "Event",
      "description": "Create and control timers"
    },
    {
      "name": "teams:read",
      "group": "Event",
      "description": "View teams, pits and rooms' teams"
    },
    {
      "name": "teams:edit",
      "group": "Event",
      "description": "Edit teams, pits and team media"
    },
    {
      "name": "rooms:read",
      "group": "Event",
      "description": "View rooms and livestream links"
    },
    {
      "name": "rooms:manage",
      "group": "Event",
      "description": "Create and edit rooms"
    },
    {
      "name": "overlays:read",
      "group": "Event",
      "description": "View overlays"
    },
    {
      "name": "overlays:edit",
      "group": "Event",
      "description": "Control overlays"
    },
    {
      "name": "analysis:view",
      "group": "Event",
      "description": "Open the Analysis desk"
    },
    {
      "name": "comms:read",
      "group": "Comms and notifications",
      "description": "View the event agenda"
    },
    {
      "name": "comms:manage",
      "group": "Comms and notifications",
      "description": "Edit the event agenda"
    },
    {
      "name": "notifications:receive",
      "group": "Comms and notifications",
      "description": "Receive notifications"
    },
    {
      "name": "notifications:broadcast",
      "group": "Comms and notifications",
      "description": "Broadcast notifications"
    },
    {
      "name": "notifications:manage",
      "group": "Comms and notifications",
      "description": "Manage notification settings"
    },
    {
      "name": "prompter:view",
      "group": "Prompter",
      "description": "View the prompter"
    },
    {
      "name": "prompter:control",
      "group": "Prompter",
      "description": "Start and control the prompter"
    },
    {
      "name": "prompter:edit",
      "group": "Prompter",
      "description": "Edit prompter scripts"
    },
    {
      "name": "video:upload",
      "group": "Media",
      "description": "Upload team videos"
    },
    {
      "name": "capture:upload",
      "group": "Media",
      "description": "Capture agent: upload recordings and connect to /ws/agent"
    },
    {
      "name": "settings:read",
      "group": "Settings",
      "description": "View settings"
    },
    {
      "name": "settings:edit",
      "group": "Settings",
      "description": "Change settings, API keys and roles"
    }
  ],
  "presets": [
    {
      "id": "capture-agent",
      "label": "Capture agent",
      "description": "Exactly what the recording agent needs (upload and connect).",
      "permissions": [
        "capture:upload"
      ]
    },
    {
      "id": "analysis-desk",
      "label": "Analysis desk",
      "description": "Replay and scene control for emcees and analysts.",
      "permissions": [
        "analysis:view",
        "capture:control",
        "video:control",
        "integrations:read",
        "teams:read",
        "vfx:control"
      ]
    },
    {
      "id": "event-admin",
      "label": "Rooms and broadcasts",
      "description": "Manage rooms, broadcast notifications and run capture.",
      "permissions": [
        "rooms:read",
        "rooms:manage",
        "notifications:broadcast",
        "capture:control"
      ]
    },
    {
      "id": "prompter",
      "label": "Prompter operator",
      "description": "View and run the prompter.",
      "permissions": [
        "prompter:view",
        "prompter:control"
      ]
    },
    {
      "id": "read-only",
      "label": "Read-only client",
      "description": "Look at everything, change nothing.",
      "permissions": [
        "integrations:read",
        "automations:read",
        "timers:read",
        "teams:read",
        "rooms:read",
        "overlays:read",
        "settings:read"
      ]
    }
  ]
};

export const INTEGRATION_SCHEMAS = {
  "artnet": {
    "name": "Art-Net (DMX over IP)",
    "version": "1.0.0",
    "description": "Send Art-Net DMX frames (e.g. to drive MagicQ virtual sliders via a Node 1 Universe interface).",
    "requires_oauth": false,
    "config_schema": {
      "ip": {
        "type": "string",
        "label": "Art-Net Target IP (or broadcast address)",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "UDP Port (default 6454)",
        "secret": false
      },
      "universe": {
        "type": "integer",
        "label": "Universe (0-32767, default 0)",
        "secret": false
      },
      "refresh_hz": {
        "type": "integer",
        "label": "Keep-alive refresh rate in Hz (default 4)",
        "secret": false
      }
    },
    "services": {
      "set_channels": {
        "description": "Set a run of DMX channels (values 0-255) starting at a channel (1-512).",
        "fields": {
          "start": {
            "type": "integer",
            "required": true
          },
          "values": {
            "type": "array",
            "required": true
          }
        }
      },
      "set_slider": {
        "description": "Set one channel/slider to a level (0-255) or a percent (0-100).",
        "fields": {
          "channel": {
            "type": "integer",
            "required": true
          },
          "level": {
            "type": "integer",
            "required": false
          },
          "percent": {
            "type": "number",
            "required": false
          }
        }
      },
      "fade": {
        "description": "Fade one channel/slider to a level (0-255) or percent (0-100) over a duration.",
        "fields": {
          "channel": {
            "type": "integer",
            "required": true
          },
          "level": {
            "type": "integer",
            "required": false
          },
          "percent": {
            "type": "number",
            "required": false
          },
          "duration_ms": {
            "type": "integer",
            "required": true
          }
        }
      },
      "blackout": {
        "description": "Set every channel in the universe to 0 and cancel running fades.",
        "fields": {}
      }
    }
  },
  "atem": {
    "name": "Blackmagic ATEM",
    "version": "1.0.0",
    "description": "ATEM video switcher control (program/preview input).",
    "requires_oauth": false,
    "config_schema": {
      "ip": {
        "type": "string",
        "label": "ATEM IP Address",
        "secret": false
      },
      "field_to_input": {
        "type": "object",
        "label": "Field ID -> ATEM Input Number",
        "secret": false
      }
    },
    "services": {
      "switch_input": {
        "description": "Switch the ME1 program input.",
        "fields": {
          "input_index": {
            "type": "integer",
            "required": true
          }
        }
      },
      "set_preview": {
        "description": "Switch the ME1 preview input.",
        "fields": {
          "input_index": {
            "type": "integer",
            "required": true
          }
        }
      }
    }
  },
  "capture": {
    "name": "Capture agent (match recording and instant replay)",
    "version": "1.0.0",
    "description": "Controls the local ffmpeg capture agent: record each match and mark replay moments.",
    "requires_oauth": false,
    "config_schema": {},
    "services": {
      "start_recording": {
        "description": "Start recording a match. Pass the TM match tuple (e.g. `match: {{ trigger.payload.match }}`) and the teams.",
        "fields": {
          "match": {
            "type": "object",
            "required": false
          },
          "round": {
            "type": "string",
            "required": false
          },
          "instance": {
            "type": "integer",
            "required": false
          },
          "match_num": {
            "type": "integer",
            "required": false
          },
          "red_teams": {
            "type": "array",
            "required": false
          },
          "blue_teams": {
            "type": "array",
            "required": false
          }
        }
      },
      "stop_recording": {
        "description": "Stop the active recording (no-op if nothing is recording).",
        "fields": {}
      },
      "mark_moment": {
        "description": "Mark a replay moment: cut the last N seconds of the active recording.",
        "fields": {
          "seconds": {
            "type": "number",
            "required": true
          }
        }
      }
    }
  },
  "obs": {
    "name": "OBS Studio",
    "version": "1.0.0",
    "description": "OBS scene/hotkey control via obs-websocket (protocol v5, OBS 28+).",
    "requires_oauth": false,
    "config_schema": {
      "host": {
        "type": "string",
        "label": "OBS Host",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "OBS WebSocket Port",
        "secret": false
      },
      "password": {
        "type": "string",
        "label": "OBS WebSocket Password",
        "secret": true
      }
    },
    "services": {
      "switch_scene": {
        "description": "Switch the current program scene.",
        "fields": {
          "scene_name": {
            "type": "string",
            "required": true
          }
        }
      },
      "trigger_hotkey": {
        "description": "Trigger a named OBS hotkey.",
        "fields": {
          "hotkey_name": {
            "type": "string",
            "required": true
          }
        }
      }
    }
  },
  "osc": {
    "name": "OSC Sender",
    "version": "1.0.0",
    "description": "Send arbitrary OSC messages over UDP (lighting consoles, show control, etc.).",
    "requires_oauth": false,
    "config_schema": {
      "ip": {
        "type": "string",
        "label": "OSC Target IP Address",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "OSC UDP Port",
        "secret": false
      }
    },
    "services": {
      "send": {
        "description": "Send one OSC message.",
        "fields": {
          "address": {
            "type": "string",
            "required": true
          },
          "args": {
            "type": "array",
            "required": false
          }
        }
      },
      "send_bundle": {
        "description": "Send several OSC messages in order.",
        "fields": {
          "messages": {
            "type": "array",
            "required": true
          }
        }
      }
    }
  },
  "ptz": {
    "name": "PTZ Camera (VISCA over IP)",
    "version": "1.0.0",
    "description": "PTZ camera control via VISCA-over-IP (UDP, default port 52381) \u2014 Sony-style cameras, BirdDog and compatible.",
    "requires_oauth": false,
    "config_schema": {
      "host": {
        "type": "string",
        "label": "Camera IP Address",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "VISCA UDP Port",
        "secret": false
      },
      "camera_address": {
        "type": "integer",
        "label": "VISCA Camera Address (1-7)",
        "secret": false
      }
    },
    "services": {
      "recall_preset": {
        "description": "Recall a stored position (0-254).",
        "fields": {
          "preset": {
            "type": "integer",
            "required": true
          }
        }
      },
      "store_preset": {
        "description": "Store the current position as a preset (0-254).",
        "fields": {
          "preset": {
            "type": "integer",
            "required": true
          }
        }
      },
      "move": {
        "description": "Start moving. direction: left|right|up|down|up_left|up_right|down_left|down_right; speed 1-24.",
        "fields": {
          "direction": {
            "type": "string",
            "required": true
          },
          "speed": {
            "type": "integer",
            "required": false
          }
        }
      },
      "stop": {
        "description": "Stop pan/tilt and zoom movement."
      },
      "home": {
        "description": "Return to the home position."
      },
      "zoom": {
        "description": "Start zooming. direction: in|out|stop; speed 0-7 (0 = standard).",
        "fields": {
          "direction": {
            "type": "string",
            "required": true
          },
          "speed": {
            "type": "integer",
            "required": false
          }
        }
      }
    }
  },
  "spotify": {
    "name": "Spotify",
    "version": "1.0.0",
    "description": "Spotify playback control (PKCE browser auth)",
    "requires_oauth": true,
    "config_schema": {
      "client_id": {
        "type": "string",
        "label": "Spotify Client ID",
        "secret": false
      },
      "client_secret": {
        "type": "string",
        "label": "Spotify Client Secret",
        "secret": true
      },
      "device_name": {
        "type": "string",
        "label": "Playback Device Name",
        "secret": false
      }
    },
    "services": {
      "play": {
        "description": "Resume/start playback, optionally on a given context.",
        "fields": {
          "context_uri": {
            "type": "string",
            "required": false
          }
        }
      },
      "play_playlist_track": {
        "description": "Play a track from a playlist by 1-based position, or a random track if omitted.",
        "fields": {
          "playlist_uri": {
            "type": "string",
            "required": true
          },
          "track_number": {
            "type": "integer",
            "required": false
          }
        }
      },
      "play_track": {
        "description": "Play a specific track URI, optionally seeking to a start time.",
        "fields": {
          "track_uri": {
            "type": "string",
            "required": true
          },
          "start_time_s": {
            "type": "number",
            "required": false
          }
        }
      },
      "pause": {
        "description": "Pause playback."
      },
      "next": {
        "description": "Skip to the next track."
      },
      "previous": {
        "description": "Skip to the previous track."
      },
      "set_volume": {
        "description": "Set playback volume (0-100).",
        "fields": {
          "volume": {
            "type": "integer",
            "required": true
          }
        }
      }
    }
  },
  "vex_tm": {
    "name": "VEX Tournament Manager",
    "version": "1.0.0",
    "description": "VEX TM field-set control: match flow, schedule polling, rankings.",
    "requires_oauth": false,
    "config_schema": {
      "base_url": {
        "type": "string",
        "label": "TM Base URL",
        "secret": false
      },
      "client_id": {
        "type": "string",
        "label": "OAuth2 Client ID",
        "secret": false
      },
      "client_secret": {
        "type": "string",
        "label": "OAuth2 Client Secret",
        "secret": true
      },
      "api_key": {
        "type": "string",
        "label": "HMAC API Key",
        "secret": true
      },
      "field_set_id": {
        "type": "integer",
        "label": "Field Set ID",
        "secret": false
      },
      "poll_interval_seconds": {
        "type": "integer",
        "label": "Schedule Poll Interval (seconds)",
        "secret": false
      },
      "auth_url": {
        "type": "string",
        "label": "OAuth2 Token Endpoint (advanced/testing override)",
        "secret": false
      }
    },
    "services": {
      "start_match": {
        "description": "Start the currently queued match on this field set."
      },
      "end_early": {
        "description": "End the current match early."
      },
      "abort": {
        "description": "Abort the current match."
      },
      "reset": {
        "description": "Reset the field."
      },
      "queue_next_match": {
        "description": "Advance the queue to the next match."
      },
      "queue_prev_match": {
        "description": "Rewind the queue to the previous match."
      },
      "set_audience_display": {
        "description": "Change the audience display mode.",
        "fields": {
          "display": {
            "type": "string",
            "required": true
          }
        }
      },
      "queue_skills": {
        "description": "Queue a skills match run.",
        "fields": {
          "skills_id": {
            "type": "integer",
            "required": true
          }
        }
      }
    }
  },
  "wled": {
    "name": "WLED LED Strips",
    "version": "1.0.0",
    "description": "WLED LED strip control (field LEDs) via the WLED JSON API.",
    "requires_oauth": false,
    "config_schema": {
      "host": {
        "type": "string",
        "label": "WLED Host / IP",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "HTTP Port",
        "secret": false
      }
    },
    "services": {
      "set_power": {
        "description": "Turn the strip on or off.",
        "fields": {
          "true": {
            "type": "boolean",
            "required": true
          }
        }
      },
      "set_brightness": {
        "description": "Set master brightness (0-255).",
        "fields": {
          "brightness": {
            "type": "integer",
            "required": true
          }
        }
      },
      "set_color": {
        "description": "Set the primary colour (hex like #FF0000).",
        "fields": {
          "color": {
            "type": "string",
            "required": true
          }
        }
      },
      "set_preset": {
        "description": "Apply a saved WLED preset.",
        "fields": {
          "preset": {
            "type": "integer",
            "required": true
          }
        }
      },
      "set_effect": {
        "description": "Apply an effect by id, with optional speed/intensity.",
        "fields": {
          "effect": {
            "type": "integer",
            "required": true
          },
          "speed": {
            "type": "integer",
            "required": false
          },
          "intensity": {
            "type": "integer",
            "required": false
          }
        }
      },
      "flash": {
        "description": "Flash the strip then restore its previous state.",
        "fields": {
          "color": {
            "type": "string",
            "required": false
          },
          "count": {
            "type": "integer",
            "required": false
          },
          "interval_ms": {
            "type": "integer",
            "required": false
          }
        }
      }
    }
  },
  "zeros": {
    "name": "ZerOS Lighting",
    "version": "1.0.0",
    "description": "ZerOS lighting console control over OSC/UDP.",
    "requires_oauth": false,
    "config_schema": {
      "ip": {
        "type": "string",
        "label": "ZerOS Board IP Address",
        "secret": false
      },
      "port": {
        "type": "integer",
        "label": "OSC UDP Port",
        "secret": false
      }
    },
    "services": {
      "set_preset": {
        "description": "Fire a lighting preset by number or by name (resolved via zeros_presets).",
        "fields": {
          "preset_id": {
            "type": "integer",
            "required": false
          },
          "preset_name": {
            "type": "string",
            "required": false
          }
        }
      }
    }
  }
} as unknown as IntegrationSchemasResponse;
