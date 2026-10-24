import { useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ScreenContainer from '../../components/layout/ScreenContainer';
import OnboardingIllustration from '../../components/common/OnboardingIllustration';
import PaginationDots from '../../components/common/PaginationDots';
import PrimaryButton from '../../components/buttons/PrimaryButton';
import { ONBOARDING_SLIDES } from '../../constants/onboardingData';
import { ROUTES } from '../../constants/routes';
import { useAuthStore } from '../../store/authStore';

export default function OnboardingScreen() {
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const setHasOnboarded = useAuthStore((s) => s.setHasOnboarded);

  const isLastSlide = activeIndex === ONBOARDING_SLIDES.length - 1;

  const finishOnboarding = () => {
    setHasOnboarded(true);
    navigation.replace(ROUTES.LOGIN);
  };

  const goToNext = () => {
    if (isLastSlide) {
      finishOnboarding();
      return;
    }
    const nextIndex = activeIndex + 1;
    listRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    setActiveIndex(nextIndex);
  };

  const renderSlide = ({ item }) => (
    <View style={{ width }} className="flex-1 px-8">
      <View className="flex-1 items-center justify-center">
        <OnboardingIllustration type={item.illustration} />
        <Text className="mt-10 text-center text-[26px] font-bold leading-8 text-white">
          {item.title}
        </Text>
        <Text className="mt-3 text-center text-base leading-6 text-secondary">
          {item.description}
        </Text>
      </View>
    </View>
  );

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View className="flex-row justify-end px-5 pt-2">
        <Pressable onPress={finishOnboarding} hitSlop={12} className="active:opacity-70">
          <Text className="text-base text-secondary">Skip</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={ONBOARDING_SLIDES}
        keyExtractor={(item) => item.id}
        renderItem={renderSlide}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          setActiveIndex(index);
        }}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
      />

      <View className="px-6 pb-8">
        <PaginationDots
          count={ONBOARDING_SLIDES.length}
          activeIndex={activeIndex}
        />

        <PrimaryButton
          label={isLastSlide ? 'Get started' : 'Continue'}
          onPress={goToNext}
          icon={isLastSlide ? undefined : 'arrow-right'}
          className="mt-8"
        />
      </View>
    </ScreenContainer>
  );
}
