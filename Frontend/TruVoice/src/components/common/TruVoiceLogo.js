import React, { useEffect } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

// Individual Bar Component for Smooth Native Thread Animations
function WaveBar({ index, size, barWidth, barGap, barsStartX, color, isAnimating }) {
  const centerY = size * 0.5;

  // Initial and keyframe heights for each bar
  const baseHeights = [0.08, 0.32, 0.36, 0.08];
  const targetHeights = [
    [0.08, 0.22, 0.12, 0.28],
    [0.18, 0.12, 0.38, 0.15],
    [0.08, 0.32, 0.18, 0.35],
    [0.22, 0.18, 0.36, 0.08],
  ];

  const heightVal = useSharedValue(baseHeights[index] * size);

  useEffect(() => {
    if (!isAnimating) return;

    const duration = 400 + (index % 3) * 120;
    const easing = Easing.inOut(Easing.quad);

    // Sequence through target heights continuously
    heightVal.value = withRepeat(
      withSequence(
        withTiming(targetHeights[0][index] * size, { duration, easing }),
        withTiming(targetHeights[1][index] * size, { duration, easing }),
        withTiming(targetHeights[2][index] * size, { duration, easing }),
        withTiming(targetHeights[3][index] * size, { duration, easing })
      ),
      -1, // Loop infinitely
      true // Reverse loop smoothly
    );
  }, [isAnimating, size]);

  // Animated SVG props
  const animatedProps = useAnimatedProps(() => {
    const h = heightVal.value;
    return {
      height: h,
      y: centerY - h / 2,
    };
  });

  const x = barsStartX + index * (barWidth + barGap);

  return (
    <AnimatedRect
      x={x}
      width={barWidth}
      rx={barWidth / 2}
      fill={color}
      animatedProps={animatedProps}
    />
  );
}

// TruVoice shield + smoothly animated waveform logo component
export default function TruVoiceLogo({ size = 72, color = '#3B82F6', isAnimating = true }) {
  const barWidth = size * 0.055;
  const barGap = size * 0.04;
  const barsStartX = size * 0.32;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Shield Path */}
      <Path
        d={`
          M ${size * 0.5} ${size * 0.12}
          L ${size * 0.78} ${size * 0.24}
          L ${size * 0.78} ${size * 0.52}
          C ${size * 0.78} ${size * 0.72} ${size * 0.5} ${size * 0.88} ${size * 0.5} ${size * 0.88}
          C ${size * 0.5} ${size * 0.88} ${size * 0.22} ${size * 0.72} ${size * 0.22} ${size * 0.52}
          L ${size * 0.22} ${size * 0.24}
          Z
        `}
        fill="none"
        stroke={color}
        strokeWidth={size * 0.028}
        strokeLinejoin="round"
      />

      {/* 5 Smoothly Animated Bars */}
      {[0, 1, 2, 3, 4].map((index) => (
        <WaveBar
          key={`bar-${index}`}
          index={index}
          size={size}
          barWidth={barWidth}
          barGap={barGap}
          barsStartX={barsStartX}
          color={color}
          isAnimating={isAnimating}
        />
      ))}
    </Svg>
  );
}