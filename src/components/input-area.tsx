import { useState } from "react";
import { Plus } from "lucide-react";
import { ThemeMode } from "@/types/follow-list";

type InputAreaProps = {
  theme: ThemeMode;
};

export function InputArea({ theme }: InputAreaProps) {
  const [prompt, setPrompt] = useState("");
  const isDark = theme === "dark";

  const containerClass = isDark
    ? "bg-[#1A1A1A] border-white/10 shadow-2xl"
    : "bg-white/90 backdrop-blur-md border-gray-200 shadow-[0_8px_30px_rgb(0,0,0,0.12)]";

  const inputClass = isDark ? "text-gray-300 placeholder-gray-500" : "text-gray-800 placeholder-gray-400";

  const btnClass = isDark ? "bg-white/10 hover:bg-white/20 text-white" : "bg-black/5 hover:bg-black/10 text-gray-800";

  return (
    <div className="absolute bottom-6 right-6 z-50 flex flex-col items-end gap-3 w-[400px]">
      <div className={`w-full rounded-[32px] p-2 pr-2 pl-4 flex items-center border transition-colors duration-300 ${containerClass}`}>
        <input
          type="text"
          placeholder="Describe your video..."
          className={`bg-transparent border-none outline-none text-sm flex-1 h-10 mr-2 ${inputClass}`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="flex items-center gap-2">
          <button className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors ${btnClass}`}>
            <Plus className="w-5 h-5" />
          </button>
          <button className={`px-5 h-10 rounded-full transition-colors text-sm font-medium ${btnClass}`}>Storyboard</button>
        </div>
      </div>
    </div>
  );
}
