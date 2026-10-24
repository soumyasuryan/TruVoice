import { View } from 'react-native';

export default function PaginationDots({ count = 3, activeIndex = 0 }) {
  return (
    <View className="flex-row items-center justify-center gap-2">
      {Array.from({ length: count }).map((_, index) => {
        const isActive = index === activeIndex;
        return (
          <View
            key={`dot-${index}`}
            className={`h-2 rounded-full ${
              isActive ? 'w-7 bg-primary' : 'w-2 bg-white/15'
            }`}
          />
        );
      })}
    </View>
  );
}
