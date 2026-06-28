import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env'

export const supabaseAdmin = () => {
  const env = getEnv()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}
