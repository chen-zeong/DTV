import React from 'react';
import { Flame, Swords, Heart, Ghost, Star, Moon, Baby } from 'lucide-react';
import { Category, HeroContent, Movie, Friend } from './types';

export const CATEGORIES: Category[] = [
  { id: 'trending', name: 'Trending', icon: <Flame size={18} /> },
  { id: 'action', name: 'Action', icon: <Swords size={18} /> },
  { id: 'romance', name: 'Romance', icon: <Heart size={18} /> },
  { id: 'animation', name: 'Animation', icon: <Baby size={18} /> },
  { id: 'horror', name: 'Horror', icon: <Ghost size={18} /> },
  { id: 'special', name: 'Special', icon: <Star size={18} /> },
  { id: 'drakor', name: 'Drakor', icon: <Moon size={18} /> },
];

export const HERO_CONTENT: HeroContent[] = [
  {
    id: 1,
    title: "Black Myth: Wukong Live Event",
    description: "Exclusive gameplay premiere and developer interview.",
    image: "https://picsum.photos/seed/wukong/800/400",
    theme: 'blue'
  },
  {
    id: 2,
    title: "LPL Summer Split Finals 2024",
    description: "The ultimate showdown: BLG vs JDG.",
    image: "https://picsum.photos/seed/esports/800/400",
    theme: 'orange'
  }
];

export const INITIAL_MOVIES: Movie[] = [
  {
    id: 1,
    title: "Loetoeng Kasarung",
    rating: 7.8,
    year: 2023,
    image: "https://picsum.photos/seed/monkey/300/450",
    category: "animation"
  },
  {
    id: 2,
    title: "Gajah Langka",
    rating: 6.0,
    year: 2023,
    image: "https://picsum.photos/seed/elephant/300/450",
    category: "animation"
  },
  {
    id: 3,
    title: "Si Kang Satay",
    rating: 7.1,
    year: 2023,
    image: "https://picsum.photos/seed/satay/300/450",
    category: "animation"
  },
  {
    id: 4,
    title: "Mommy Cat",
    rating: 7.8,
    year: 2023,
    image: "https://picsum.photos/seed/catmom/300/450",
    category: "animation"
  },
  {
    id: 5,
    title: "Hijaber Cantiq",
    rating: 6.1,
    year: 2023,
    image: "https://picsum.photos/seed/girl/300/450",
    category: "animation"
  },
  {
    id: 6,
    title: "Xatra- X",
    rating: 6.5,
    year: 2022,
    image: "https://picsum.photos/seed/hero/300/450",
    category: "animation"
  }
];

export const FRIENDS_LIST: Friend[] = [
  { id: 1, name: 'Alex M.', image: 'https://picsum.photos/seed/alex/100/100', status: 'online', activity: 'Browsing' },
  { id: 2, name: 'Jessica W.', image: 'https://picsum.photos/seed/jessica/100/100', status: 'playing', activity: 'Watching Loetoeng...' },
  { id: 3, name: 'David B.', image: 'https://picsum.photos/seed/david/100/100', status: 'offline', activity: 'Last seen 10m ago' },
  { id: 4, name: 'Sarah Connor', image: 'https://picsum.photos/seed/sarah/100/100', status: 'online', activity: 'Searching' },
  { id: 5, name: 'John Doe', image: 'https://picsum.photos/seed/john/100/100', status: 'playing', activity: 'Watching Dune' },
];