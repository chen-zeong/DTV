import Image from "next/image";

export function BackgroundFeed() {
  return (
    <div className="absolute inset-0 z-0 bg-gray-900">
      <div className="relative w-full h-full overflow-hidden">
        <Image
          src="https://images.unsplash.com/photo-1570125909232-eb263c188f7e?q=80&w=2671&auto=format&fit=crop"
          alt="Bus Driver Video Feed"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-80"
        />

        <div className="absolute top-20 right-[440px] left-[500px] z-10 pointer-events-none" />

        <div className="absolute top-8 left-[460px] flex items-center gap-2 z-20">
          <div className="bg-black/40 backdrop-blur-md rounded-full px-1 py-1 pr-4 flex items-center gap-2">
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center">
              <span className="text-black font-bold text-xs">Sora</span>
            </div>
            <div className="flex flex-col">
              <span className="text-white text-xs font-bold leading-none">Sora</span>
              <span className="text-gray-300 text-[10px] leading-none">@ahmed.alakedy</span>
            </div>
          </div>
        </div>

        <div className="absolute bottom-32 right-8 max-w-[300px] text-right z-20">
          <h3 className="text-white font-bold drop-shadow-md">ahmed.alakedy</h3>
        </div>
      </div>
    </div>
  );
}
