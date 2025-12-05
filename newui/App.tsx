import React, { useState } from 'react';
import { Sun, Moon, Filter, SlidersHorizontal } from 'lucide-react';
import Header from './components/Header';
import MovieCard from './components/MovieCard';
import AISearchModal from './components/AISearchModal';
import Sidebar from './components/Sidebar';
import { CATEGORIES, INITIAL_MOVIES } from './constants';

const App: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [activeCategory, setActiveCategory] = useState('animation');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Toggle Theme
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <div className={`min-h-screen w-full transition-colors duration-500 ease-in-out relative ${
      isDarkMode 
        ? 'bg-slate-900 text-white selection:bg-purple-500/30' 
        : 'bg-slate-50 text-slate-900 selection:bg-purple-500/20'
    }`}>
      
      {/* Background Gradients/Mesh */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {isDarkMode ? (
            <>
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-900/20 rounded-full blur-[120px]" />
                <div className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-purple-900/20 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] left-[20%] w-[60%] h-[40%] bg-slate-800/40 rounded-full blur-[100px]" />
            </>
        ) : (
            <>
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-200/40 rounded-full blur-[120px]" />
                <div className="absolute top-[20%] right-[-10%] w-[40%] h-[60%] bg-purple-200/40 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] left-[20%] w-[60%] h-[40%] bg-slate-200/60 rounded-full blur-[100px]" />
            </>
        )}
      </div>

      {/* Main Content Wrapper - Added padding-left for sidebar space */}
      <div className="relative z-10 w-full lg:pl-[80px] transition-all duration-300">
        <div className="max-w-[1600px] mx-auto pb-12">
            
            {/* Header */}
            <Header 
            onSearchClick={() => setIsSearchOpen(true)} 
            isDarkMode={isDarkMode} 
            />

            {/* Categories Section */}
            <section className="px-6 md:px-12 mt-4 mb-8">
                <div className="flex items-center gap-4 overflow-x-auto hide-scroll pb-2">
                    {CATEGORIES.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setActiveCategory(cat.id)}
                            className={`
                                flex items-center gap-2 px-6 py-3.5 rounded-2xl whitespace-nowrap transition-all duration-300
                                ${activeCategory === cat.id 
                                    ? (isDarkMode ? 'bg-white text-slate-900 font-bold shadow-lg shadow-white/10' : 'bg-slate-800 text-white font-bold shadow-lg shadow-slate-300')
                                    : (isDarkMode ? 'bg-white/5 text-gray-300 hover:bg-white/10' : 'bg-white/60 text-slate-600 hover:bg-white shadow-sm')
                                }
                                backdrop-blur-md
                            `}
                        >
                            {cat.icon}
                            <span>{cat.name}</span>
                        </button>
                    ))}
                </div>
            </section>

            {/* Movies Grid Section */}
            <section className="px-6 md:px-12">
                <div className="flex items-center justify-between mb-6">
                    <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                        Trending in {CATEGORIES.find(c => c.id === activeCategory)?.name}
                    </h2>
                    
                    <div className={`flex items-center gap-2 px-1 py-1 rounded-xl ${
                        isDarkMode ? 'bg-black/30' : 'bg-white/60 shadow-sm border border-slate-100'
                    }`}>
                        <button className={`p-2 rounded-lg transition-all ${
                            isDarkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-slate-100 text-slate-500'
                        }`}>
                            <Filter size={18} />
                        </button>
                        <button className={`p-2 rounded-lg ${
                            isDarkMode ? 'bg-white/10 text-white' : 'bg-slate-200 text-slate-800'
                        }`}>
                            <SlidersHorizontal size={18} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                    {INITIAL_MOVIES.map((movie) => (
                        <MovieCard key={movie.id} movie={movie} isDarkMode={isDarkMode} />
                    ))}
                </div>
            </section>
        </div>
      </div>

      {/* Sidebar - Only visible on large screens to avoid cluttering mobile */}
      <div className="hidden lg:block">
        <Sidebar isDarkMode={isDarkMode} />
      </div>

      {/* Floating Theme Toggle - Moved to bottom right to not conflict with sidebar */}
      <button
        onClick={toggleTheme}
        className={`fixed bottom-8 right-8 p-4 rounded-full shadow-2xl z-40 transition-all duration-300 hover:scale-110 ${
            isDarkMode 
            ? 'bg-white text-slate-900 shadow-white/10' 
            : 'bg-slate-900 text-white shadow-slate-400'
        }`}
        aria-label="Toggle Theme"
      >
        {isDarkMode ? <Sun size={24} /> : <Moon size={24} />}
      </button>

      {/* AI Search Modal */}
      <AISearchModal 
        isOpen={isSearchOpen} 
        onClose={() => setIsSearchOpen(false)} 
        isDarkMode={isDarkMode} 
      />

    </div>
  );
};

export default App;