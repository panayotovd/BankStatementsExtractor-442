import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface Transaction {
  date: string;
  description: string;
  amount: number;
  category: string;
  notes: string;
}

export async function extractTransactions(fileBase64: string, mimeType: string): Promise<Transaction[]> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `
    Extract all transactions from this bank statement.
    Return a JSON array of objects with the following structure:
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "amount": number (positive for deposits, negative for expenses),
      "category": "string (e.g., groceries, dining, transport, salary, bills, etc.)",
      "notes": "string"
    }
    
    Requirements:
    - Extract ALL transactions.
    - Format dates as YYYY-MM-DD.
    - Amounts must be numbers. Deposits are positive, expenses are negative.
    - Categorize each transaction automatically.
    - Skip headers, totals, and non-transaction rows.
    - If the document has multiple pages, extract from all of them.
  `;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            date: { type: Type.STRING },
            description: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            notes: { type: Type.STRING },
          },
          required: ["date", "description", "amount", "category", "notes"],
        },
      },
    },
  });

  try {
    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Failed to parse Gemini response:", error);
    return [];
  }
}
