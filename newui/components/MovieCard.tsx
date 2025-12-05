import React from 'react';
import { Star } from 'lucide-react';
import { Movie } from '../types';

interface MovieCardProps {
  movie: Movie;
  isDarkMode: boolean;
}

const MovieCard: React.FC<MovieCardProps> = ({ movie, isDarkMode }) => {
  return (
    <div className="flex-shrink-0 w-[180px] md:w-[220px] group cursor-pointer">
      <div className={`relative aspect-[2/3] rounded-2xl overflow-hidden mb-3 transition-all duration-300 group-hover:-translate-y-2 ${
        isDarkMode ? 'shadow-lg shadow-black/40' : 'shadow-lg shadow-slate-300/50'
      }`}>
        <img 
          src={movie.image} 
          alt={movie.title} 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
            <button className="w-full py-2 bg-white text-black rounded-lg font-medium text-sm transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                Watch Now
            </button>
        </div>
      </div>
      
      <div className="px-1">
        <h3 className={`font-semibold text-lg truncate ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
          {movie.title}
        </h3>
        <div className="flex items-center gap-3 mt-1">
          <div className="flex items-center gap-1 text-orange-400">
            <Star size={14} fill="currentColor" />
            <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>
              {movie.rating}
            </span>
          </div>
          <span className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>
            {movie.year}
          </span>
        </div>
      </div>
    </div>
  );
};

export default MovieCard;
