import { GoogleGenAI, Type } from "@google/genai";
import { Movie } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const searchMoviesWithAI = async (query: string): Promise<Movie[]> => {
  if (!process.env.API_KEY) {
    console.warn("No API Key provided for Gemini.");
    return [];
  }

  try {
    // We'll ask Gemini to hallucinate/retrieve movies based on the query to fit our UI format
    const prompt = `
      User is searching for: "${query}".
      Generate a list of 4 fictional or real movie recommendations that fit this search query.
      For the image field, provide a keyword for picsum.photos like 'space', 'cat', 'love', etc.
      The category should be one of: 'trending', 'action', 'romance', 'animation', 'horror'.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              title: { type: Type.STRING },
              rating: { type: Type.NUMBER },
              year: { type: Type.INTEGER },
              image: { type: Type.STRING },
              category: { type: Type.STRING },
              description: { type: Type.STRING }
            },
            required: ["id", "title", "rating", "year", "category"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];

    const rawMovies = JSON.parse(text);
    
    // Transform to match our strict Movie interface and add functional image URLs
    return rawMovies.map((m: any, index: number) => ({
      id: 100 + index,
      title: m.title,
      rating: m.rating || 7.5,
      year: m.year || 2024,
      image: `https://picsum.photos/seed/${m.image || 'movie'}/300/450`,
      category: m.category || 'special'
    }));

  } catch (error) {
    console.error("Gemini Search Error:", error);
    return [];
  }
};