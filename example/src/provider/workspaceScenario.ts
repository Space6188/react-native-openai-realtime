export const WORKSPACE_INSTRUCTIONS = `
You are Atlas Workspace Assistant, helping teams reserve creative studios and meeting rooms.

=== WHAT YOU DO ===
- Gather requirements for workspace sessions.
- Use tools to look up spaces, generate price quotes, create bookings, and surface last-minute offers.
- Keep responses concise, professional, and friendly.

=== RESPONSE RULES ===
1. Output must be plain text. No Markdown bullets, headings, or code fences.
2. When a tool is needed, follow a two-step pattern:
   • Step 1: send a short acknowledgement message (without calling a tool).
   • Step 2: in the next turn, call the tool and present the result.
3. Ask for any missing required information before calling a tool. Never invent details.
4. When presenting data, use short sentences. Separate items with semicolons if you need a list.

=== TOOL USAGE ===
list_workspaces:
  Required: none.
  Ask when users want to browse available spaces or capabilities.
  Ack example: "One moment please, I'm checking which spaces fit your request."

calculate_workspace_quote:
  Required fields:
    • city (string)
    • capacity (number of attendees)
    • start_time (ISO 8601)
    • end_time (ISO 8601)
    • layout (string, e.g., "workshop" or "boardroom")
  Optional: equipment list (array of strings), catering (boolean)
  Ack example: "Let me calculate a quote for that booking. Give me a moment."

create_workspace_booking:
  Required fields:
    • quote_id (string from a previous quote)
    • customer_email
    • customer_name
    • customer_phone
  Optional: notes (string)
  Ack example: "Perfect, I'm locking that in right now. Please hold on a second."

list_last_minute_offers:
  Required: none.
  Ack example: "Let me see which last-minute deals we have right now."

=== GENERAL INFO (no tool required) ===
- WiFi and basic AV equipment are included in every booking.
- Premium equipment (lighting kits, 4K cameras) requires advance notice.
- Catering is provided via local partners; vegetarian and vegan menus are available.
- Workspace staff can help with check-in and setup thirty minutes before the reservation.

Stay helpful and proactive. Offer to gather more details when information is incomplete.
`;

export const WORKSPACE_TOOLS = [
  {
    type: 'function' as const,
    name: 'list_workspaces',
    description:
      'Fetch available workspace options filtered by city or capabilities.',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: 'City to filter by (optional)',
        },
        needs: {
          type: 'array',
          description: 'Desired equipment or features',
          items: {type: 'string'},
        },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'calculate_workspace_quote',
    description:
      'Generate a price quote for a workspace reservation with required booking details.',
    parameters: {
      type: 'object',
      required: ['city', 'capacity', 'start_time', 'end_time', 'layout'],
      properties: {
        city: {type: 'string'},
        capacity: {type: 'number', minimum: 1},
        start_time: {type: 'string', description: 'ISO 8601 start time'},
        end_time: {type: 'string', description: 'ISO 8601 end time'},
        layout: {type: 'string'},
        equipment: {
          type: 'array',
          items: {type: 'string'},
          description: 'Requested equipment (optional)',
        },
        catering: {
          type: 'boolean',
          description: 'Whether catering is required (optional)',
        },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'create_workspace_booking',
    description:
      'Confirm a reservation using a previously issued quote identifier.',
    parameters: {
      type: 'object',
      required: [
        'quote_id',
        'customer_email',
        'customer_name',
        'customer_phone',
      ],
      properties: {
        quote_id: {type: 'string'},
        customer_email: {type: 'string'},
        customer_name: {type: 'string'},
        customer_phone: {type: 'string'},
        notes: {
          type: 'string',
          description: 'Additional context for onsite staff',
        },
      },
    },
  },
  {
    type: 'function' as const,
    name: 'list_last_minute_offers',
    description:
      'Retrieve discounted workspace slots that start within the next 48 hours.',
    parameters: {
      type: 'object',
      properties: {
        city: {type: 'string'},
      },
    },
  },
];

export const TOOL_ACK_MESSAGES: Record<string, string> = {
  list_workspaces:
    "One moment please, I'm checking which spaces fit your request.",
  calculate_workspace_quote:
    'Let me calculate a quote for that booking. Give me a moment.',
  create_workspace_booking:
    "Perfect, I'm locking that in right now. Please hold on a second.",
  list_last_minute_offers:
    'Let me see which last-minute deals we have right now.',
};

export type WorkspaceToolName = (typeof WORKSPACE_TOOLS)[number]['name'];

