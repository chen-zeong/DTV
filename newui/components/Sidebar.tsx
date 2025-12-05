import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Users, MessageCircle } from 'lucide-react';
import { Friend } from '../types';
import { FRIENDS_LIST } from '../constants';

interface SidebarProps {
  isDarkMode: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isDarkMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <aside
      className={`
        fixed left-0 top-0 h-full z-50 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        border-r backdrop-blur-xl flex flex-col
        ${isExpanded ? 'w-72 shadow-2xl' : 'w-[80px]'}
        ${isDarkMode 
          ? 'bg-slate-900/80 border-white/10 text-white' 
          : 'bg-white/70 border-white/40 text-slate-800 shadow-xl'
        }
      `}
    >
      {/* Header */}
      <div className={`h-[88px] flex items-center justify-center relative w-full border-b ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
        {isExpanded ? (
           <span className="font-semibold text-lg animate-in fade-in slide-in-from-left-2 duration-300">
             Friends
           </span>
        ) : (
          <Users size={24} className={isDarkMode ? 'text-gray-400' : 'text-slate-500'} />
        )}
      </div>

      {/* User List */}
      <div className="flex-1 overflow-y-auto py-6 hide-scroll">
        <div className="flex flex-col gap-4 px-3">
          {FRIENDS_LIST.map((friend) => (
            <div 
              key={friend.id} 
              className={`
                group flex items-center p-2 rounded-xl transition-all duration-200 cursor-pointer
                ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}
                ${isExpanded ? 'gap-3' : 'justify-center'}
              `}
            >
              {/* Avatar Container */}
              <div className="relative flex-shrink-0">
                <img 
                  src={friend.image} 
                  alt={friend.name} 
                  className="w-10 h-10 rounded-full object-cover ring-2 ring-transparent group-hover:ring-purple-500 transition-all"
                />
                {/* Status Dot */}
                <div className={`
                  absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 
                  ${isDarkMode ? 'border-slate-900' : 'border-white'}
                  ${friend.status === 'online' ? 'bg-green-500' : 
                    friend.status === 'playing' ? 'bg-purple-500' : 'bg-gray-400'}
                `}/>
              </div>

              {/* Info (Only visible when expanded) */}
              {isExpanded && (
                <div className="flex-1 min-w-0 overflow-hidden animate-in fade-in slide-in-from-left-2 duration-300">
                  <h4 className={`text-sm font-semibold truncate ${isDarkMode ? 'text-gray-200' : 'text-slate-800'}`}>
                    {friend.name}
                  </h4>
                  <p className={`text-xs truncate ${
                    friend.status === 'online' ? 'text-green-500' :
                    friend.status === 'playing' ? 'text-purple-400' : 'text-gray-500'
                  }`}>
                    {friend.activity}
                  </p>
                </div>
              )}
              
              {isExpanded && (
                <button className={`p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${isDarkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}>
                    <MessageCircle size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Actions: Online Count & Toggle */}
      <div className={`flex flex-col items-center justify-center border-t transition-colors
         ${isDarkMode ? 'border-white/5 bg-black/20' : 'border-black/5 bg-white/40'}
      `}>
          {/* Online count section */}
          <div className="p-4 flex flex-col items-center justify-center">
            <div className="flex -space-x-2 mb-2">
                {FRIENDS_LIST.slice(0, 3).map(f => (
                    <img key={f.id} src={f.image} className="w-6 h-6 rounded-full border-2 border-transparent" alt="" />
                ))}
            </div>
            {isExpanded && (
                <p className={`text-xs font-medium animate-in fade-in duration-300 ${isDarkMode ? 'text-gray-400' : 'text-slate-500'}`}>
                    {FRIENDS_LIST.filter(f => f.status !== 'offline').length} Online Now
                </p>
            )}
          </div>

          {/* Toggle Button (Moved to bottom) */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`
                w-full py-3 flex items-center justify-center border-t transition-colors
                ${isDarkMode 
                    ? 'border-white/5 hover:bg-white/5 text-gray-400 hover:text-white' 
                    : 'border-black/5 hover:bg-black/5 text-slate-500 hover:text-slate-800'
                }
            `}
          >
            {isExpanded ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
      </div>
    </aside>
  );
};

export default Sidebar;