import React from 'react';
import { Play } from 'lucide-react';
import { HERO_CONTENT } from '../constants';

interface HeroProps {
  isDarkMode: boolean;
}

const Hero: React.FC<HeroProps> = ({ isDarkMode }) => {
  return (
    <section className="px-6 md:px-12 py-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
      {HERO_CONTENT.map((item) => (
        <div 
          key={item.id}
          className={`relative group overflow-hidden rounded-3xl h-[300px] md:h-[380px] w-full transition-transform duration-500 hover:scale-[1.01] ${
            isDarkMode ? 'shadow-2xl shadow-black/50' : 'shadow-xl shadow-slate-300'
          }`}
        >
          {/* Background Image */}
          <div className="absolute inset-0">
            <img 
              src={item.image} 
              alt={item.title} 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            {/* Gradient Overlay */}
            <div className={`absolute inset-0 bg-gradient-to-r ${
              item.theme === 'blue' 
                ? 'from-blue-900/80 via-blue-900/40 to-transparent' 
                : 'from-orange-900/80 via-orange-900/40 to-transparent'
            }`} />
          </div>

          {/* Content */}
          <div className="absolute inset-0 p-8 flex flex-col justify-center items-start text-white">
            <h2 className="text-3xl md:text-5xl font-bold leading-tight max-w-md drop-shadow-lg mb-4">
              {item.title}
            </h2>
            
            <button className={`
              mt-4 flex items-center gap-3 px-6 py-3 rounded-full 
              backdrop-blur-md border border-white/20 
              transition-all duration-300 group-hover:bg-white group-hover:text-black
              ${isDarkMode ? 'bg-black/30 hover:bg-white' : 'bg-white/20 hover:bg-white'}
            `}>
              <div className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center">
                <Play size={14} fill="white" />
              </div>
              <span className="font-medium">Let Play Movie</span>
            </button>
          </div>
        </div>
      ))}
    </section>
  );
};

export default Hero;
