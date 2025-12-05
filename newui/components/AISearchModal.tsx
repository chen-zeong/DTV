import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, Search } from 'lucide-react';
import { searchMoviesWithAI } from '../services/geminiService';
import { Movie } from '../types';
import MovieCard from './MovieCard';

interface AISearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

const AISearchModal: React.FC<AISearchModalProps> = ({ isOpen, onClose, isDarkMode }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Movie[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setResults([]);
      setHasSearched(false);
    }
  }, [isOpen]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    const movies = await searchMoviesWithAI(query);
    setResults(movies);
    setIsLoading(false);
    setHasSearched(true);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal Content */}
      <div className={`
        relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-3xl 
        flex flex-col shadow-2xl transition-colors
        ${isDarkMode ? 'bg-[#1a1f2e] border border-white/10' : 'bg-white border border-slate-200'}
      `}>
        {/* Header */}
        <div className={`p-6 border-b ${isDarkMode ? 'border-white/5' : 'border-slate-100'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="text-purple-400" />
              <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                AI Magic Search
              </h2>
            </div>
            <button 
              onClick={onClose}
              className={`p-2 rounded-full hover:bg-gray-500/10 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}
            >
              <X size={20} />
            </button>
          </div>
          
          <form onSubmit={handleSearch} className="relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Describe a movie... e.g., 'Space adventure with a raccoon'"
              className={`
                w-full pl-12 pr-4 py-4 rounded-xl text-lg outline-none transition-all
                ${isDarkMode 
                  ? 'bg-black/30 text-white placeholder-gray-500 border border-white/10 focus:border-purple-500/50' 
                  : 'bg-slate-50 text-slate-800 placeholder-slate-400 border border-slate-200 focus:border-purple-500/50'
                }
              `}
              autoFocus
            />
            <Search 
              className={`absolute left-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`} 
              size={20} 
            />
            <button 
                type="submit"
                disabled={isLoading}
                className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
                {isLoading ? <Loader2 className="animate-spin" size={16} /> : 'Ask AI'}
            </button>
          </form>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[300px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 opacity-50">
              <Loader2 className="animate-spin text-purple-500" size={40} />
              <p className={isDarkMode ? 'text-gray-400' : 'text-slate-500'}>Consulting the movie spirits...</p>
            </div>
          ) : hasSearched && results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <p className={`text-lg ${isDarkMode ? 'text-gray-300' : 'text-slate-600'}`}>No results found.</p>
              <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>Try a different description.</p>
            </div>
          ) : results.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {results.map((movie) => (
                <MovieCard key={movie.id} movie={movie} isDarkMode={isDarkMode} />
              ))}
            </div>
          ) : (
             <div className="flex flex-col items-center justify-center h-full gap-4">
                 <div className={`p-4 rounded-full ${isDarkMode ? 'bg-white/5' : 'bg-slate-100'}`}>
                    <Sparkles className={isDarkMode ? 'text-gray-600' : 'text-gray-400'} size={40} />
                 </div>
                 <p className={`text-center max-w-sm ${isDarkMode ? 'text-gray-500' : 'text-slate-400'}`}>
                    Use Gemini AI to find movies by mood, plot description, or obscure details.
                 </p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AISearchModal;
