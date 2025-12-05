import React, { useState } from 'react';
import { Search, Bell, ChevronDown } from 'lucide-react';

interface HeaderProps {
  onSearchClick: () => void;
  isDarkMode: boolean;
}

const Header: React.FC<HeaderProps> = ({ onSearchClick, isDarkMode }) => {
  const [activeTab, setActiveTab] = useState('Douyu');
  const tabs = ['Douyu', 'Huya', 'Douyin', 'Bilibili'];

  return (
    <header className="flex items-center justify-between px-6 py-4 md:px-12 md:py-6 relative z-20">
      {/* Logo */}
      <div className="flex items-center">
        <h1 className={`text-2xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
          Flix.id
        </h1>
      </div>

      {/* Navigation Pill - Redesigned to match reference image */}
      <div className={`hidden md:flex items-center pl-8 pr-2 py-2 rounded-full transition-all duration-300 ${
        isDarkMode 
          ? 'bg-[#121212] border border-white/5 shadow-2xl shadow-black/20' 
          : 'bg-white border border-slate-100 shadow-xl shadow-slate-200/60'
      }`}>
        <div className="flex items-center gap-8 mr-6">
            {tabs.map((tab) => (
                <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`text-sm font-medium transition-colors duration-200 ${
                        activeTab === tab
                        ? (isDarkMode ? 'text-white' : 'text-slate-900')
                        : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-slate-400 hover:text-slate-600')
                    }`}
                >
                    {tab}
                </button>
            ))}
        </div>

        {/* Search Circle */}
        <button 
          onClick={onSearchClick}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            isDarkMode 
            ? 'bg-white/10 text-white hover:bg-white/20' 
            : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
          }`}
        >
          <Search size={18} />
        </button>
      </div>

      {/* User Profile */}
      <div className="flex items-center gap-4">
        <button className={`relative p-2 rounded-full transition-colors ${
           isDarkMode ? 'text-gray-300 hover:bg-white/10' : 'text-slate-600 hover:bg-black/5'
        }`}>
          <Bell size={20} />
          <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-transparent"></span>
        </button>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <img 
              src="https://picsum.photos/seed/user/100/100" 
              alt="Profile" 
              className="w-10 h-10 rounded-full object-cover border-2 border-white/20"
            />
            <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border border-white"></div>
          </div>
          <div className="hidden lg:block text-left">
            <p className={`text-sm font-semibold leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Sarah J</p>
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>Premium</p>
          </div>
          <ChevronDown size={16} className={`hidden lg:block ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`} />
        </div>
      </div>
    </header>
  );
};

export default Header;