import React from 'react';

export interface Movie {
  id: number;
  title: string;
  rating: number;
  year: number;
  image: string;
  category: string;
}

export interface Category {
  id: string;
  name: string;
  icon: React.ReactNode;
}

export interface HeroContent {
  id: number;
  title: string;
  description: string;
  image: string;
  theme: 'blue' | 'orange'; // For button styling nuances
}

export interface Friend {
  id: number;
  name: string;
  image: string;
  status: 'online' | 'offline' | 'playing';
  activity?: string;
}