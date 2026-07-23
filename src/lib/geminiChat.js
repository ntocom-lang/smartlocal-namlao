import { supabase } from './supabase'

export async function askGemini(messages, userText, tenantName) {
  const { data, error } = await supabase.functions.invoke('gemini-chat', {
    body: { messages, userText, tenantName },
  })

  if (error) throw error
  if (!data?.reply) throw new Error('empty reply from gemini-chat')

  return data.reply
}
