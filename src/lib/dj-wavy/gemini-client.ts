import { GoogleGenerativeAI } from '@google/generative-ai'

export const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('missing_env_GEMINI_API_KEY')
  return new GoogleGenerativeAI(apiKey)
}
