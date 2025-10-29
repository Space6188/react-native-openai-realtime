export async function get_time() {
  return {now: new Date().toISOString()};
}

export async function get_weather(args: {city: string}) {
  const city = args?.city || 'Unknown';
  return {
    city,
    temp_c: Math.round(10 + Math.random() * 15),
    condition: 'Sunny',
    feels_like_c: Math.round(9 + Math.random() * 12),
  };
}

export async function set_reminder(args: {text: string; minutes?: number}) {
  return {
    ok: true,
    scheduled_in_minutes: args.minutes ?? 10,
    text: args.text,
  };
}
