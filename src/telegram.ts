export async function sendTelegram(
  botToken: string,
  chatId: string,
  title: string,
  message: string,
  button?: { text: string; url: string }
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload: Record<string, string> = {
    chat_id: chatId,
    text: `*${title}*\n${message}`,
    parse_mode: "Markdown",
  };
  if (button) {
    payload.reply_markup = JSON.stringify({
      inline_keyboard: [[{ text: button.text, url: button.url }]],
    });
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(payload).toString(),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram send failed: ${resp.status} ${body}`);
  }
}
