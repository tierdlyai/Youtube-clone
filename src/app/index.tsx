import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  StatusBar,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  Alert,
  Animated,
  RefreshControl,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  type LayoutChangeEvent,
  type TextLayoutEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import Svg, { Polyline, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

type TabKey = 'dashboard' | 'content' | 'analytics' | 'comments' | 'earn';
type IconName = React.ComponentProps<typeof Icon>['name'];
type Chip = { label: string; onPress: () => void };

type Video = { title: string; sub: string; views: number; likes: number; comments: number };
type Data = {
  name: string;
  subs: number;
  subsGained: number;
  views: number;
  watchHours: number;
  revenue: number;
  video: Video;
};
type Imgs = { avatar: string | null; thumb: string | null };

const C = {
  bg: '#0F0F0F',
  card: '#1F1F1F',
  text: '#FFFFFF',
  muted: '#AAAAAA',
  line: '#303030',
  green: '#2BA640',
  red: '#FF0000',
  blue: '#3EA6FF',
};

const DEFAULTS: Data = {
  name: 'My Channel',
  subs: 167346,
  subsGained: 52,
  views: 3465,
  watchHours: 3.6,
  revenue: 780.28,
  video: { title: 'My first upload', sub: 'First 12 hours, 41 minutes', views: 89, likes: 57, comments: 12 },
};

const K_DATA = 'studio:data';
const K_AVATAR = 'studio:avatar';
const K_THUMB = 'studio:thumb';

const RANGES = [
  { label: '100–1K', min: 100, max: 1000 },
  { label: '10K–100K', min: 10000, max: 100000 },
  { label: '100K–10M', min: 100000, max: 10000000 },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ---------- Helpers ---------- */

const fmt = (n: number, d = 0) => {
  const [i, f] = n.toFixed(d).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
};

const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');

// 1,100 -> 1.1K · 4,506,737 -> 4.5M · 999,999 -> 1M
const compact = (n: number) => {
  if (n >= 999950000) return trim(n / 1e9) + 'B';
  if (n >= 999950) return trim(n / 1e6) + 'M';
  if (n >= 1e3) return trim(n / 1e3) + 'K';
  return String(Math.round(n * 10) / 10);
};

// Under 1,000 keep cents (780.28), above that shorten (83.1K)
const money = (n: number) => (n >= 1000 ? compact(n) : fmt(n, 2));

const randIn = (min: number, max: number, d = 0) => {
  const f = Math.pow(10, d);
  return Math.round((min + Math.random() * (max - min)) * f) / f;
};

const parseNum = (t: string) => {
  const n = parseFloat(t.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
};

const niceStep = (v: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

// likes = random 1–10% of views, comments = random 5–20% of likes
const videoStats = (views: number) => {
  const likes = Math.round((views * randIn(1, 10, 2)) / 100);
  const comments = Math.round((likes * randIn(5, 20, 1)) / 100);
  return { views, likes, comments };
};

const videoMoney = (d: Data) =>
  d.views > 0 ? Math.round(Math.min(d.revenue, (d.video.views * d.revenue) / d.views)) : 0;

const pickImage = async (aspect: [number, number]) => {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(
      'Permission needed',
      'Allow photo access to choose a profile photo or thumbnail.'
    );
    return null;
  }

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.3,
    base64: true,
  });
  if (res.canceled || !res.assets[0]?.base64) return null;
  return `data:image/jpeg;base64,${res.assets[0].base64}`;
};

type Saved = { data: Data | null; avatar: string | null; thumb: string | null };

const readSaved = async (): Promise<Saved> => {
  try {
    const rows = await AsyncStorage.multiGet([K_DATA, K_AVATAR, K_THUMB]);
    const [d, a, t] = rows.map((r) => r[1]);
    let parsed: Data | null = null;
    if (d) {
      try {
        const p = JSON.parse(d);
        parsed = { ...DEFAULTS, ...p, video: { ...DEFAULTS.video, ...(p.video ?? {}) } };
      } catch {}
    }
    return { data: parsed, avatar: a ?? null, thumb: t ?? null };
  } catch {
    return { data: null, avatar: null, thumb: null };
  }
};

/* ---------- AdMob (rewarded) ---------- */

type AdsModule = any;

// Loaded via dynamic import so the app still runs in Expo Go,
// where the ads native module isn't available. Memoised so both
// rewarded hooks share one import.
let adsPromise: Promise<AdsModule | null> | null = null;
const loadAds = () => {
  adsPromise ??= import('react-native-google-mobile-ads').catch(() => null);
  return adsPromise;
};

// Ad 1: unlocks "Randomize everything" on the Edit screen
const AD1_REAL = 'ca-app-pub-8575196128182596/8304850019';
// Ad 2: unlocks "Payment activity" on the Earn tab
// TODO: create a 2nd rewarded unit in AdMob and paste its ID here
const AD2_REAL = 'ca-app-pub-8575196128182596/8304850019';

// Test ads while developing, your real ad units in release builds
const adUnit = (Ads: AdsModule, real: string) => (__DEV__ && Ads ? Ads.TestIds.REWARDED : real);

const useRewardedAd = (unitId: string, onReward: () => void) => {
  const [ready, setReady] = useState(false);
  const [Ads, setAds] = useState<AdsModule | null>(null);
  const adRef = useRef<any>(null);
  const rewardRef = useRef(onReward);

  useEffect(() => {
    let alive = true;
    loadAds().then((m) => {
      if (alive) setAds(m);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    rewardRef.current = onReward;
  }, [onReward]);

  useEffect(() => {
    if (!Ads) return;
    const unsubs: (() => void)[] = [];
    let retry: ReturnType<typeof setTimeout> | undefined;

    try {
      Ads.default().initialize().catch(() => {});
      const ad = Ads.RewardedAd.createForAdRequest(adUnit(Ads, unitId), {
        requestNonPersonalizedAdsOnly: true,
      });
      adRef.current = ad;

      unsubs.push(
        ad.addAdEventListener(Ads.RewardedAdEventType.LOADED, () => setReady(true)),
        ad.addAdEventListener(Ads.RewardedAdEventType.EARNED_REWARD, () => rewardRef.current()),
        ad.addAdEventListener(Ads.AdEventType.CLOSED, () => {
          setReady(false);
          ad.load();
        }),
        ad.addAdEventListener(Ads.AdEventType.ERROR, () => {
          setReady(false);
          retry = setTimeout(() => ad.load(), 15000);
        })
      );
      ad.load();
    } catch {}

    return () => {
      unsubs.forEach((u) => u());
      if (retry) clearTimeout(retry);
    };
  }, [Ads, unitId]);

  const available = !!Ads;

  const showAd = () => {
    if (!adRef.current || !ready) {
      Alert.alert('Ad not ready', 'The ad is still loading. Try again in a few seconds.');
      return;
    }
    try {
      adRef.current.show();
    } catch {
      Alert.alert('Ad error', 'Could not show the ad. Try again.');
    }
  };

  return { ready, available, showAd };
};

/* ---------- Shared pieces ---------- */

const RefreshCtx = createContext<{ refreshing: boolean; onRefresh: () => void }>({
  refreshing: false,
  onRefresh: () => {},
});

// ScrollView with pull-to-refresh
const RScroll = (props: React.ComponentProps<typeof ScrollView>) => {
  const { refreshing, onRefresh } = useContext(RefreshCtx);
  return (
    <ScrollView
      {...props}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={C.text}
          colors={[C.blue]}
          progressBackgroundColor={C.card}
        />
      }
    />
  );
};

type FittedProps = React.ComponentProps<typeof Text> & { minScale?: number };

// adjustsFontSizeToFit is declared in TextPropsIOS but only implemented on iOS,
// so on Android a clamped <Text> just truncates. Measure the natural width with a
// hidden unclamped copy and shrink the font until the text fits its box.
const FittedText = ({ children, style, minScale = 0.55, ...rest }: FittedProps) => {
  const [scale, setScale] = useState(1);
  const box = useRef(0);
  const tries = useRef(0);

  const measurable = typeof children === 'string' || typeof children === 'number';

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - box.current) > 0.5) {
      box.current = w;
      tries.current = 0;
      setScale(1);
    }
  };

  // Only ever shrinks, and gives up after a few rounds, so this converges.
  const onTextLayout = (e: TextLayoutEvent) => {
    const avail = box.current;
    if (!avail || tries.current >= 5) return;
    const natural = e.nativeEvent.lines.reduce((m, l) => Math.max(m, l.width), 0);
    if (natural <= 0 || natural <= avail) return;
    tries.current += 1;
    setScale((prev) => Math.max(minScale, prev * (avail / natural) * 0.98));
  };

  const base = StyleSheet.flatten(style)?.fontSize;
  const sized = typeof base === 'number' && scale !== 1 ? { fontSize: base * scale } : null;

  return (
    <>
      <Text {...rest} onLayout={onLayout} numberOfLines={rest.numberOfLines ?? 1} adjustsFontSizeToFit style={[style, sized]}>
        {children}
      </Text>
      {measurable && Platform.OS === 'android' && (
        <Text onTextLayout={onTextLayout} style={[style, sized, s.fittedGhost]}>
          {children}
        </Text>
      )}
    </>
  );
};

// Small fade + rise animation
const FadeIn = ({ children }: { children: React.ReactNode }) => {
  const [opacity] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(8));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();
  }, [opacity, y]);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY: y }] }}>
      {children}
    </Animated.View>
  );
};

const Avatar = ({ uri, size, bg, iconSize }: { uri: string | null; size: number; bg: string; iconSize: number }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
    {uri ? <Image source={{ uri }} style={{ width: size, height: size }} /> : <Icon name="account" size={iconSize} color="#fff" />}
  </View>
);

const Header = ({
  analytics, avatar, onBell, onProfile,
}: { analytics?: boolean; avatar: string | null; onBell: () => void; onProfile: () => void }) => (
  <View style={s.topBar}>
    <View style={s.logoRow}>
      <View style={s.logoBox}>
        <Icon name="play" size={14} color="#fff" />
      </View>
      <Text style={s.logoText}>Studio</Text>
    </View>
    <View style={s.topIcons}>
      {analytics ? (
        <>
          <Icon name="plus-circle-outline" size={27} color={C.text} />
          <Icon name="bell-outline" size={27} color={C.text} />
        </>
      ) : (
        <>
          <Icon name="magnify" size={27} color={C.text} />
          <Pressable onPress={onBell} style={s.notifBadge}>
            <Text style={s.notifText}>0</Text>
          </Pressable>
        </>
      )}
      <Pressable onPress={onProfile} hitSlop={8}>
        <Avatar uri={avatar} size={32} bg="#8E5BD9" iconSize={19} />
      </Pressable>
    </View>
  </View>
);

const Thumb = ({ uri, color = '#8E1E8E', w = 64, h = 38 }: { uri?: string | null; color?: string; w?: number; h?: number }) =>
  uri ? (
    <Image source={{ uri }} style={{ width: w, height: h, borderRadius: 4 }} resizeMode="cover" />
  ) : (
    <View style={{ width: w, height: h, borderRadius: 4, backgroundColor: color, overflow: 'hidden' }}>
      {[0.25, 0.5, 0.75].map((p) => (
        <React.Fragment key={p}>
          <View style={{ position: 'absolute', left: w * p, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
          <View style={{ position: 'absolute', top: h * p, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.25)' }} />
        </React.Fragment>
      ))}
    </View>
  );

const StatCard = ({
  label, value, icon, color, onPress,
}: { label: string; value: string; icon: IconName; color: string; onPress: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.statCard, pressed && { opacity: 0.6 }]}>
    <Text style={s.statLabel}>{label}</Text>
    <View style={s.statRow}>
      <FittedText style={s.statValue} numberOfLines={1}>{value}</FittedText>
      <Icon name={icon} size={20} color={color} />
    </View>
  </Pressable>
);

const MetricRow = ({
  label, value, icon, color, onPress,
}: { label: string; value: string; icon: IconName; color: string; onPress?: () => void }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.metricRow, pressed && { opacity: 0.6 }]}>
    <Text style={s.metricLabel}>{label}</Text>
    <View style={s.metricRight}>
      <Text style={s.metricValue}>{value}</Text>
      <Icon name={icon} size={22} color={color} />
    </View>
  </Pressable>
);

const StatIcons = ({ views, likes, comments, money: m }: { views: number; likes: number; comments: number; money?: number }) => (
  <>
    {m !== undefined && (
      <View style={s.iconStat}><Icon name="currency-usd" size={20} color={C.green} /><Text style={s.iconStatText}>{compact(m)}</Text></View>
    )}
    <View style={s.iconStat}><Icon name="chart-bar" size={20} color={C.text} /><Text style={s.iconStatText}>{compact(views)}</Text></View>
    <View style={s.iconStat}><Icon name="thumb-up-outline" size={20} color={C.text} /><Text style={s.iconStatText}>{compact(likes)}</Text></View>
    <View style={s.iconStat}><Icon name="comment-text-outline" size={20} color={C.text} /><Text style={s.iconStatText}>{compact(comments)}</Text></View>
  </>
);

/* ---------- Dashboard ---------- */

const Dashboard = ({ go, data, imgs }: { go: (t: TabKey) => void; data: Data; imgs: Imgs }) => {
  const [open, setOpen] = useState(true);
  const v = data.video;

  return (
    <RScroll contentContainerStyle={s.scroll}>
      <View style={s.channelRow}>
        <View style={{ marginRight: 16 }}>
          <Avatar uri={imgs.avatar} size={84} bg="#6FC3DF" iconSize={44} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.channelName} numberOfLines={1}>{data.name}</Text>
          <FittedText style={s.subCount} numberOfLines={1}>{fmt(data.subs)}</FittedText>
          <Text style={s.subLabel}>Total subscribers</Text>
        </View>
      </View>

      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Channel analytics</Text>
        <Text style={s.hint}>Last 28 days</Text>
      </View>

      <View style={s.grid}>
        <StatCard label="Views" value={compact(data.views)} icon="check-circle-outline" color={C.green} onPress={() => go('analytics')} />
        <StatCard label="Watch time (hours)" value={compact(data.watchHours)} icon="arrow-up-circle" color={C.green} onPress={() => go('analytics')} />
        <StatCard label="Subscribers" value={'+' + compact(data.subsGained)} icon="arrow-down-circle" color={C.muted} onPress={() => go('analytics')} />
        <StatCard label="Estimated revenue" value={'US$' + money(data.revenue)} icon="check-circle-outline" color={C.green} onPress={() => go('earn')} />
      </View>

      <Text style={[s.sectionTitle, { marginTop: 26, marginBottom: 10 }]}>Latest published content</Text>

      <View style={s.contentCard}>
        <Pressable style={s.contentRow} onPress={() => go('content')}>
          <Thumb uri={imgs.thumb} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.videoTitle} numberOfLines={1}>{v.title}</Text>
            <Text style={s.hint} numberOfLines={1}>{v.sub}</Text>
          </View>
        </Pressable>

        <View style={s.iconStats}>
          <StatIcons money={videoMoney(data)} views={v.views} likes={v.likes} comments={v.comments} />
          <Pressable onPress={() => setOpen(!open)} hitSlop={14}>
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={26} color={C.muted} />
          </Pressable>
        </View>

        {open && (
          <View>
            <MetricRow label="Ranking by views" value="6 of 10" icon="chevron-right" color={C.muted} onPress={() => go('analytics')} />
            <MetricRow label="Views" value={fmt(v.views)} icon="check-circle-outline" color={C.green} />
            <MetricRow label="Average percentage viewed" value="62.2%" icon="arrow-down-circle" color={C.muted} />
            <MetricRow label="Likes" value={fmt(v.likes)} icon="arrow-up-circle" color={C.green} />
          </View>
        )}
      </View>
    </RScroll>
  );
};

/* ---------- Content ---------- */

const Content = ({ data, imgs }: { data: Data; imgs: Imgs }) => {
  const v = data.video;
  const list = [
    { id: '0', title: v.title, sub: v.sub, views: v.views, likes: v.likes, comments: v.comments, money: videoMoney(data), thumb: imgs.thumb, color: '#8E1E8E' },
    { id: '1', title: 'BlueSky Social vs X vs LinkedIn', sub: 'First 163 days, 21 hours', views: 9, likes: 0, comments: 0, money: undefined, thumb: null, color: '#3A3A3A' },
    { id: '2', title: 'How to Schedule YouTube Videos', sub: 'Made for Kids', views: 0, likes: 0, comments: 0, money: undefined, thumb: null, color: '#3A3A3A' },
  ];

  return (
    <RScroll contentContainerStyle={s.scroll}>
      <Text style={s.sectionTitle}>Content</Text>
      {list.map((x) => (
        <Pressable key={x.id} style={({ pressed }) => [s.videoCard, pressed && { opacity: 0.6 }]}>
          <View style={s.contentRow}>
            <Thumb uri={x.thumb} color={x.color} w={64} h={38} />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.videoTitle} numberOfLines={1}>{x.title}</Text>
              <Text style={s.hint} numberOfLines={1}>{x.sub}</Text>
            </View>
          </View>
          <View style={s.videoStats}>
            <StatIcons money={x.money} views={x.views} likes={x.likes} comments={x.comments} />
          </View>
        </Pressable>
      ))}
    </RScroll>
  );
};

/* ---------- Analytics ---------- */

const TOP_TABS = ['Trends', 'Overview', 'Content', 'Audience', 'Playlists'] as const;
type TopTab = (typeof TOP_TABS)[number];

const SHAPE = [0.85, 0.8, 0.9, 0.75, 0.7, 0.82, 1.0, 0.95, 0.78, 0.68, 0.8, 0.98, 1.1, 0.92, 0.72, 0.64, 0.78, 0.88, 0.82, 0.7, 0.6, 0.74, 0.9, 1.05, 0.88, 0.84, 1.0, 1.12];
const SHAPE_B = [...SHAPE].reverse();

const LineCard = ({ title, total, shape, w }: { title: string; total: number; shape: number[]; w: number }) => {
  const labelW = 46;
  const cw = w - 32 - labelW;
  const ch = 112;

  const mean = shape.reduce((a, b) => a + b, 0) / shape.length;
  const vals = shape.map((f) => (f / mean) * (total / shape.length));
  const step = niceStep((Math.max(...vals, 0.0001) * 1.1) / 3);
  const top = step * 3;
  const ticks = [top, step * 2, step, 0];
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * cw},${ch - (v / top) * ch}`).join(' ');

  const end = new Date();
  const start = new Date(end.getTime() - 27 * 86400000);

  return (
    <View style={[s.metricCard, { width: w }]}>
      <Text style={s.hint}>{title}</Text>
      <View style={s.statRow}>
        <Text style={s.bigNumber}>{compact(total)}</Text>
        <Icon name="arrow-up-circle" size={22} color={C.green} />
      </View>
      <Text style={s.greenText}>{compact(total * 0.188)} more than usual</Text>

      <View style={{ flexDirection: 'row', marginTop: 18 }}>
        <View style={{ width: labelW, height: ch }}>
          {ticks.map((t, i) => (
            <Text key={i} style={[s.axis, { position: 'absolute', top: (i * ch) / 3 - 7 }]}>{compact(t)}</Text>
          ))}
        </View>
        <Svg width={cw} height={ch}>
          {[0, 1, 2, 3].map((i) => (
            <Line key={i} x1={0} x2={cw} y1={(i * ch) / 3} y2={(i * ch) / 3} stroke="#333" strokeWidth={1} />
          ))}
          <Polyline points={pts} fill="none" stroke={C.blue} strokeWidth={2} strokeLinejoin="round" />
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginLeft: labelW, marginTop: 6 }}>
        <Text style={s.axis}>{start.getDate()} {MON[start.getMonth()]}</Text>
        <Text style={s.axis}>{MON[end.getMonth()]} {end.getDate()}</Text>
      </View>
    </View>
  );
};

const Dots = ({ count, active }: { count: number; active: number }) => (
  <View style={s.dots}>
    {Array.from({ length: count }).map((_, i) => (
      <View key={i} style={[s.dot, i === active && { backgroundColor: C.text }]} />
    ))}
  </View>
);

const ListCard = ({ title, rows }: { title: string; rows: { a: string; b: string }[] }) => (
  <View style={[s.bigCard, { marginTop: 8 }]}>
    <Text style={s.sectionTitle}>{title}</Text>
    {rows.map((r) => (
      <View key={r.a} style={s.listRow}>
        <Text style={s.metricLabel}>{r.a}</Text>
        <Text style={s.hint}>{r.b}</Text>
      </View>
    ))}
  </View>
);

const Analytics = ({ data, imgs }: { data: Data; imgs: Imgs }) => {
  const { width } = useWindowDimensions();
  const cardW = width - 56;
  const [top, setTop] = useState<TopTab>('Overview');
  const [page, setPage] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + 12)));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.topTabs} contentContainerStyle={{ paddingHorizontal: 8 }}>
        {TOP_TABS.map((t) => (
          <Pressable key={t} onPress={() => setTop(t)} style={[s.topTab, top === t && s.topTabActive]}>
            <Text style={[s.topTabText, top === t && { color: C.text }]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <RScroll contentContainerStyle={{ paddingVertical: 16, paddingBottom: 32 }}>
        <View style={s.miniChannel}>
          <Avatar uri={imgs.avatar} size={40} bg="#6FC3DF" iconSize={22} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text style={s.videoTitle} numberOfLines={1}>{data.name}</Text>
            <Text style={s.hint}>{fmt(data.subs)} subscribers</Text>
          </View>
        </View>

        {top === 'Overview' && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={cardW + 12}
              decelerationRate="fast"
              onScroll={onScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            >
              <LineCard title="Views" total={data.views} shape={SHAPE} w={cardW} />
              <LineCard title="Watch time (hours)" total={data.watchHours} shape={SHAPE_B} w={cardW} />
            </ScrollView>
            <Dots count={2} active={page} />

            <View style={{ paddingHorizontal: 16 }}>
              <Pressable style={({ pressed }) => [s.banner, pressed && { opacity: 0.6 }]}>
                <Text style={s.bannerText}>Find out how to grow your audience</Text>
                <View style={s.bannerIcon}>
                  <Icon name="lightbulb-on-outline" size={26} color="#0F0F0F" />
                </View>
              </Pressable>
              <Dots count={3} active={0} />

              <View style={s.bigCard}>
                <Text style={s.sectionTitle}>Podcasts</Text>
                {[
                  { t: 'YouTube Release Notes', sub: 'Updated 2 days ago · 8.8K views', color: '#2C6E91' },
                  { t: 'Creator Insider podcast', sub: 'Updated 5 days ago · 3.1K views', color: '#7A3E9D' },
                ].map((p) => (
                  <View key={p.t} style={s.podRow}>
                    <View style={[s.podThumb, { backgroundColor: p.color }]}>
                      <Icon name="podcast" size={22} color="#fff" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.videoTitle} numberOfLines={1}>{p.t}</Text>
                      <Text style={s.hint}>{p.sub}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        )}

        {top === 'Trends' && (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard title="Trending in your niche" rows={[{ a: 'React Native tips', b: '+42%' }, { a: 'App clone builds', b: '+31%' }, { a: 'Expo Router', b: '+18%' }]} />
          </View>
        )}
        {top === 'Content' && (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard title="Top content" rows={[{ a: data.video.title, b: `${fmt(data.video.views)} views` }]} />
          </View>
        )}
        {top === 'Audience' && (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard title="Audience" rows={[{ a: 'Subscribers', b: fmt(data.subs) }, { a: 'New subscribers', b: '+' + fmt(data.subsGained) }, { a: 'Views', b: fmt(data.views) }]} />
          </View>
        )}
        {top === 'Playlists' && (
          <View style={{ paddingHorizontal: 16 }}>
            <ListCard title="Top playlists" rows={[{ a: 'Clone projects', b: '640 views' }, { a: 'Tutorials', b: '412 views' }]} />
          </View>
        )}
      </RScroll>
    </View>
  );
};

/* ---------- Comments ---------- */

const COMMENTS = [
  { id: '1', user: '@techwithsam', text: 'This helped so much, thank you!', time: '2h' },
  { id: '2', user: '@mira_codes', text: 'Can you make one on React Native next?', time: '5h' },
  { id: '3', user: '@devjay', text: 'Great pacing, subscribed.', time: '1d' },
];

const Comments = () => (
  <RScroll contentContainerStyle={s.scroll}>
    <Text style={s.sectionTitle}>Comments</Text>
    {COMMENTS.map((c) => (
      <View key={c.id} style={s.commentCard}>
        <Avatar uri={null} size={32} bg="#8E5BD9" iconSize={19} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.videoTitle}>{c.user} <Text style={s.hint}>· {c.time}</Text></Text>
          <Text style={s.commentText}>{c.text}</Text>
        </View>
      </View>
    ))}
  </RScroll>
);

/* ---------- Earn ---------- */

type EarnProps = {
  data: Data;
  adAvailable: boolean;
  adReady: boolean;
  unlocked: boolean;
  open: boolean;
  onPayPress: () => void;
};

const Earn = ({ data, adAvailable, adReady, unlocked, open, onPayPress }: EarnProps) => {
  const nowMonth = new Date().getMonth();
  const month = MONTHS[nowMonth];
  const amount = '$' + fmt(data.revenue, 2);
  const locked = adAvailable && !unlocked;

  const btnLabel = locked
    ? adReady ? 'Watch ad to view payment activity' : 'Loading ad…'
    : open ? 'Hide payment activity' : 'View payment activity';

  const history = [1, 0.91, 0.84].map((f, i) => ({
    label: `${MONTHS[(nowMonth - i + 12) % 12]} payment`,
    amount: '$' + fmt(data.revenue * f, 2),
    status: i === 0 ? 'Pending' : 'Paid',
  }));

  return (
    <RScroll contentContainerStyle={s.scroll}>
      <Text style={s.partnerTitle}>You&apos;re a YouTube Partner</Text>

      <View style={s.bigCard}>
        <Text style={s.hint}>A payment is headed your way!</Text>
        <Text style={s.hint}>Expect a payment between {month} 21–23</Text>
        <FittedText style={s.payAmount} numberOfLines={1}>{amount}</FittedText>
        <View style={s.divider} />
        <Text style={s.hint}>{month} earnings</Text>
        <FittedText style={s.earnings} numberOfLines={1}>{amount}</FittedText>
        <Text style={s.hint}>Payment estimates may vary</Text>
      </View>

      <Pressable
        onPress={onPayPress}
        style={({ pressed }) => [s.payBtn, locked && !adReady && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
      >
        {locked && <Icon name="gift-outline" size={18} color={C.blue} />}
        <Text style={s.payBtnText}>{btnLabel}</Text>
      </Pressable>

      {open && (
        <View style={s.bigCard}>
          <Text style={s.sectionTitle}>Payment activity</Text>
          {history.map((h) => (
            <View key={h.label} style={s.listRow}>
              <View>
                <Text style={s.metricLabel}>{h.label}</Text>
                <Text style={s.hint}>{h.status}</Text>
              </View>
              <Text style={s.metricLabel}>{h.amount}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={[s.sectionTitle, { marginTop: 24 }]}>What you&apos;re using</Text>
      {[
        { icon: 'play-circle' as IconName, label: 'Watch page ads', color: C.blue },
        { icon: 'lightning-bolt' as IconName, label: 'Shorts feed ads', color: '#FF8A3D' },
        { icon: 'star' as IconName, label: 'Memberships', color: C.green },
      ].map((i) => (
        <Pressable key={i.label} style={({ pressed }) => [s.useRow, pressed && { opacity: 0.6 }]}>
          <Icon name={i.icon} size={28} color={i.color} />
          <Text style={s.useLabel}>{i.label}</Text>
          <Icon name="chevron-right" size={22} color={C.muted} style={{ marginLeft: 'auto' }} />
        </Pressable>
      ))}
    </RScroll>
  );
};

/* ---------- Edit screen ---------- */

const TextField = ({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) => (
  <View style={s.field}>
    <Text style={s.fieldLabel}>{label}</Text>
    <TextInput style={s.textInput} value={value} onChangeText={onChange} placeholderTextColor={C.muted} />
  </View>
);

const NumField = ({
  label, value, onChange, decimals = 0, prefix, chips, hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  decimals?: number;
  prefix?: string;
  chips?: Chip[];
  hint?: string;
}) => {
  const [text, setText] = useState(String(value));
  const [syncedValue, setSyncedValue] = useState(value);

  if (value !== syncedValue) {
    setSyncedValue(value);
    if (parseNum(text) !== value) setText(String(value));
  }

  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <View style={s.inputRow}>
        {prefix ? <Text style={s.prefix}>{prefix}</Text> : null}
        <TextInput
          style={s.input}
          value={text}
          onChangeText={(t) => {
            setText(t);
            onChange(parseNum(t));
          }}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          placeholderTextColor={C.muted}
        />
      </View>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
      {chips && (
        <View style={s.chips}>
          {chips.map((c) => (
            <Pressable key={c.label} style={({ pressed }) => [s.chip, pressed && { opacity: 0.6 }]} onPress={c.onPress}>
              <Icon name="dice-multiple-outline" size={16} color={C.blue} />
              <Text style={s.chipText}>{c.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
};

type EditProps = {
  data: Data;
  imgs: Imgs;
  patch: (p: Partial<Data>) => void;
  patchVideo: (p: Partial<Video>) => void;
  setVideoViews: (n: number) => void;
  setImgs: React.Dispatch<React.SetStateAction<Imgs>>;
  randomizeAll: (r: { min: number; max: number }) => void;
  reset: () => void;
  onBack: () => void;
  adAvailable: boolean;
  adReady: boolean;
  unlocked: boolean;
  onWatchAd: () => void;
};

const Edit = ({
  data, imgs, patch, patchVideo, setVideoViews, setImgs, randomizeAll, reset, onBack,
  adAvailable, adReady, unlocked, onWatchAd,
}: EditProps) => {
  const v = data.video;
  const locked = adAvailable && !unlocked;
  const rangeChips = (fn: (n: number) => void, d = 0): Chip[] =>
    RANGES.map((r) => ({ label: r.label, onPress: () => fn(randIn(r.min, r.max, d)) }));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.editBar}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Icon name="arrow-left" size={26} color={C.text} />
        </Pressable>
        <Text style={s.editTitle}>Edit channel</Text>
        <Pressable onPress={reset} hitSlop={12}>
          <Text style={s.resetText}>Reset</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.editScroll} keyboardShouldPersistTaps="handled">
        <Text style={s.hint}>Changes save automatically on this device.</Text>

        {/* Randomize all (unlocked by a rewarded ad) */}
        <View style={[s.bigCard, { marginTop: 16 }]}>
          <Text style={s.fieldLabel}>Randomize everything</Text>
          {locked ? (
            <>
              <Text style={s.hint}>Watch a short ad to unlock this for the session.</Text>
              <Pressable
                onPress={onWatchAd}
                style={({ pressed }) => [s.adBtn, !adReady && { opacity: 0.5 }, pressed && { opacity: 0.7 }]}
              >
                <Icon name="gift-outline" size={20} color="#fff" />
                <Text style={s.adBtnText}>{adReady ? 'Watch ad to unlock' : 'Loading ad…'}</Text>
              </Pressable>
            </>
          ) : (
            <View style={s.chips}>
              {RANGES.map((r) => (
                <Pressable key={r.label} style={({ pressed }) => [s.chip, pressed && { opacity: 0.6 }]} onPress={() => randomizeAll(r)}>
                  <Icon name="shuffle-variant" size={16} color={C.blue} />
                  <Text style={s.chipText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Profile */}
        <Text style={s.editSection}>Channel</Text>
        <View style={s.avatarEdit}>
          <Pressable
            onPress={async () => {
              const u = await pickImage([1, 1]);
              if (u) setImgs((p) => ({ ...p, avatar: u }));
            }}
          >
            <Avatar uri={imgs.avatar} size={96} bg="#6FC3DF" iconSize={52} />
            <View style={s.cameraBadge}>
              <Icon name="camera" size={16} color="#fff" />
            </View>
          </Pressable>
          {imgs.avatar && (
            <Pressable onPress={() => setImgs((p) => ({ ...p, avatar: null }))} style={{ marginTop: 10 }}>
              <Text style={s.resetText}>Remove photo</Text>
            </Pressable>
          )}
        </View>

        <TextField label="Channel name" value={data.name} onChange={(t) => patch({ name: t })} />
        <NumField label="Total subscribers" value={data.subs} onChange={(n) => patch({ subs: n })} chips={rangeChips((n) => patch({ subs: n }))} />
        <NumField label="New subscribers (last 28 days)" value={data.subsGained} onChange={(n) => patch({ subsGained: n })} chips={rangeChips((n) => patch({ subsGained: n }))} />
        <NumField label="Views (last 28 days)" value={data.views} onChange={(n) => patch({ views: n })} chips={rangeChips((n) => patch({ views: n }))} />
        <NumField label="Watch time (hours)" value={data.watchHours} decimals={1} onChange={(n) => patch({ watchHours: n })} chips={rangeChips((n) => patch({ watchHours: n }), 1)} />
        <NumField label="Estimated revenue" prefix="US$" value={data.revenue} decimals={2} onChange={(n) => patch({ revenue: n })} chips={rangeChips((n) => patch({ revenue: n }), 2)} hint="Also shown on the Earn tab." />

        {/* Video */}
        <Text style={s.editSection}>Latest video</Text>
        <View style={s.field}>
          <Text style={s.fieldLabel}>Thumbnail</Text>
          <Pressable
            onPress={async () => {
              const u = await pickImage([16, 9]);
              if (u) setImgs((p) => ({ ...p, thumb: u }));
            }}
          >
            <Thumb uri={imgs.thumb} w={224} h={126} />
          </Pressable>
          <View style={s.chips}>
            <Pressable
              style={s.chip}
              onPress={async () => {
                const u = await pickImage([16, 9]);
                if (u) setImgs((p) => ({ ...p, thumb: u }));
              }}
            >
              <Icon name="image-outline" size={16} color={C.blue} />
              <Text style={s.chipText}>Choose thumbnail</Text>
            </Pressable>
            {imgs.thumb && (
              <Pressable style={s.chip} onPress={() => setImgs((p) => ({ ...p, thumb: null }))}>
                <Icon name="close" size={16} color={C.blue} />
                <Text style={s.chipText}>Remove</Text>
              </Pressable>
            )}
          </View>
        </View>

        <TextField label="Video title" value={v.title} onChange={(t) => patchVideo({ title: t })} />
        <TextField label="Posted info" value={v.sub} onChange={(t) => patchVideo({ sub: t })} />
        <NumField
          label="Video views"
          value={v.views}
          onChange={setVideoViews}
          chips={rangeChips(setVideoViews)}
          hint="Likes and comments update to a random share of the views."
        />
        <NumField
          label="Likes"
          value={v.likes}
          onChange={(n) => patchVideo({ likes: n })}
          chips={[{ label: 'Random 1–10%', onPress: () => patchVideo({ likes: Math.round((v.views * randIn(1, 10, 2)) / 100) }) }]}
        />
        <NumField
          label="Comments"
          value={v.comments}
          onChange={(n) => patchVideo({ comments: n })}
          chips={[{ label: 'Random', onPress: () => patchVideo({ comments: Math.round((v.likes * randIn(5, 20, 1)) / 100) }) }]}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/* ---------- App ---------- */

const TABS: { key: TabKey; label: string; icon: IconName; active: IconName }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'view-dashboard-outline', active: 'view-dashboard' },
  { key: 'content', label: 'Content', icon: 'play-box-outline', active: 'play-box' },
  { key: 'analytics', label: 'Analytics', icon: 'chart-box-outline', active: 'chart-box' },
  { key: 'comments', label: 'Comments', icon: 'comment-text-outline', active: 'comment-text' },
  { key: 'earn', label: 'Earn', icon: 'currency-usd', active: 'currency-usd' },
];

export default function Index() {
  const [tab, setTab] = useState<TabKey>('dashboard');
  const [screen, setScreen] = useState<'main' | 'edit'>('main');
  const [data, setData] = useState<Data>(DEFAULTS);
  const [imgs, setImgs] = useState<Imgs>({ avatar: null, thumb: null });
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Ad 1: unlocks "Randomize everything"
  const [unlocked, setUnlocked] = useState(false);
  const ad1 = useRewardedAd(AD1_REAL, () => setUnlocked(true));

  // Ad 2: unlocks "Payment activity" on the Earn tab
  const [payUnlocked, setPayUnlocked] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const ad2 = useRewardedAd(AD2_REAL, () => {
    setPayUnlocked(true);
    setPayOpen(true);
  });

  const onPayPress = () => {
    if (!ad2.available || payUnlocked) setPayOpen((o) => !o);
    else ad2.showAd();
  };

  // Load saved data
  useEffect(() => {
    let alive = true;
    readSaved().then((r) => {
      if (!alive) return;
      if (r.data) setData(r.data);
      setImgs({ avatar: r.avatar, thumb: r.thumb });
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Auto-save
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(K_DATA, JSON.stringify(data));
  }, [data, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (imgs.avatar) AsyncStorage.setItem(K_AVATAR, imgs.avatar);
    else AsyncStorage.removeItem(K_AVATAR);
  }, [imgs.avatar, loaded]);

  useEffect(() => {
    if (!loaded) return;
    if (imgs.thumb) AsyncStorage.setItem(K_THUMB, imgs.thumb);
    else AsyncStorage.removeItem(K_THUMB);
  }, [imgs.thumb, loaded]);

  // Android back button closes the edit screen
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'edit') {
        setScreen('main');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  const onRefresh = async () => {
    setRefreshing(true);
    const [r] = await Promise.all([readSaved(), new Promise<void>((res) => setTimeout(res, 700))]);
    if (r.data) setData(r.data);
    setImgs({ avatar: r.avatar, thumb: r.thumb });
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  };

  const patch = (p: Partial<Data>) => setData((d) => ({ ...d, ...p }));
  const patchVideo = (p: Partial<Video>) => setData((d) => ({ ...d, video: { ...d.video, ...p } }));
  const setVideoViews = (n: number) => patchVideo(videoStats(n));

  const randomizeAll = (r: { min: number; max: number }) => {
    const views = randIn(r.min, r.max, 0);
    const videoViews = Math.max(1, Math.round((views * randIn(1, 20, 2)) / 100));
    setData((d) => ({
      ...d,
      subs: randIn(r.min, r.max, 0),
      subsGained: Math.max(1, randIn(r.min * 0.01, r.max * 0.05, 0)),
      views,
      watchHours: randIn(r.min, r.max, 1),
      revenue: randIn(r.min, r.max, 2),
      video: { ...d.video, ...videoStats(videoViews) },
    }));
  };

  const reset = () => {
    setData(DEFAULTS);
    setImgs({ avatar: null, thumb: null });
  };

  if (!loaded) return <SafeAreaView style={s.safe} />;

  if (screen === 'edit') {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <FadeIn>
          <Edit
            data={data}
            imgs={imgs}
            patch={patch}
            patchVideo={patchVideo}
            setVideoViews={setVideoViews}
            setImgs={setImgs}
            randomizeAll={randomizeAll}
            reset={reset}
            onBack={() => setScreen('main')}
            adAvailable={ad1.available}
            adReady={ad1.ready}
            unlocked={unlocked}
            onWatchAd={ad1.showAd}
          />
        </FadeIn>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <Header
        analytics={tab === 'analytics'}
        avatar={imgs.avatar}
        onBell={() => setTab('comments')}
        onProfile={() => setScreen('edit')}
      />

      <RefreshCtx.Provider value={{ refreshing, onRefresh }}>
        <View style={{ flex: 1 }}>
          <FadeIn key={`${tab}-${refreshKey}`}>
            {tab === 'dashboard' && <Dashboard go={setTab} data={data} imgs={imgs} />}
            {tab === 'content' && <Content data={data} imgs={imgs} />}
            {tab === 'analytics' && <Analytics data={data} imgs={imgs} />}
            {tab === 'comments' && <Comments />}
            {tab === 'earn' && (
              <Earn
                data={data}
                adAvailable={ad2.available}
                adReady={ad2.ready}
                unlocked={payUnlocked}
                open={payOpen}
                onPayPress={onPayPress}
              />
            )}
          </FadeIn>
        </View>
      </RefreshCtx.Provider>

      <View style={s.tabBar}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => setTab(t.key)}>
              <Icon name={on ? t.active : t.icon} size={26} color={on ? C.text : C.muted} />
              <Text style={[s.tabLabel, on && { color: C.text, fontWeight: '600' }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, paddingBottom: 32 },

  fittedGhost: { position: 'absolute', opacity: 0 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  logoBox: { width: 32, height: 22, borderRadius: 6, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontSize: 22, fontWeight: '700', marginLeft: 6, color: C.text },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  notifBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#3A3A3A', alignItems: 'center', justifyContent: 'center' },
  notifText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  channelRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 26 },
  channelName: { fontSize: 17, fontWeight: '700', color: C.text },
  subCount: { fontSize: 27, fontWeight: '700', color: C.text },
  subLabel: { fontSize: 14, color: C.muted },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: C.text, marginBottom: 4 },
  hint: { fontSize: 14, color: C.muted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  statCard: { width: '48.5%', backgroundColor: C.card, borderRadius: 14, padding: 16 },
  statLabel: { fontSize: 14, color: C.muted, marginBottom: 8 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statValue: { fontSize: 23, fontWeight: '600', color: C.text, flexShrink: 1 },

  contentCard: { backgroundColor: C.card, borderRadius: 14, padding: 16 },
  contentRow: { flexDirection: 'row', alignItems: 'center' },
  iconStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  iconStat: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  iconStatText: { fontSize: 15, color: C.text },

  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
  metricLabel: { fontSize: 15, color: C.text },
  metricRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metricValue: { fontSize: 15, color: C.text },

  videoCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginTop: 12 },
  videoTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 2 },
  videoStats: { flexDirection: 'row', gap: 28, marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },

  topTabs: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  topTab: { paddingVertical: 12, paddingHorizontal: 14 },
  topTabActive: { borderBottomWidth: 2, borderBottomColor: C.text },
  topTabText: { fontSize: 16, color: C.muted, fontWeight: '600' },
  miniChannel: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 16 },

  metricCard: { backgroundColor: C.card, borderRadius: 14, padding: 16 },
  bigNumber: { fontSize: 32, fontWeight: '700', color: C.text },
  greenText: { fontSize: 14, color: C.green, marginTop: 2 },
  axis: { fontSize: 11, color: C.muted },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 14 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4A4A4A' },

  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 14, padding: 18 },
  bannerText: { flex: 1, fontSize: 16, color: C.text, marginRight: 12 },
  bannerIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#3DD6C0', alignItems: 'center', justifyContent: 'center' },

  bigCard: { backgroundColor: C.card, borderRadius: 14, padding: 16, marginTop: 8 },
  podRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  podThumb: { width: 48, height: 48, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },

  commentCard: { flexDirection: 'row', backgroundColor: C.card, borderRadius: 14, padding: 16, marginTop: 12 },
  commentText: { fontSize: 15, color: C.text },

  partnerTitle: { fontSize: 25, fontWeight: '700', color: C.text, textAlign: 'center', marginVertical: 12 },
  payAmount: { fontSize: 38, fontWeight: '700', color: C.text, marginTop: 8, marginBottom: 14 },
  earnings: { fontSize: 27, fontWeight: '700', color: C.text, marginVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginBottom: 14 },
  payBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.card, borderRadius: 24, paddingVertical: 14, marginTop: 14, marginBottom: 6 },
  payBtnText: { color: C.blue, fontSize: 15, fontWeight: '600' },
  useRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: 14, padding: 16, marginTop: 12 },
  useLabel: { fontSize: 16, color: C.text },

  editBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  editTitle: { fontSize: 20, fontWeight: '700', color: C.text },
  resetText: { fontSize: 15, color: C.blue, fontWeight: '600' },
  editScroll: { padding: 16, paddingBottom: 80 },
  editSection: { fontSize: 19, fontWeight: '700', color: C.text, marginTop: 28, marginBottom: 4 },
  avatarEdit: { alignItems: 'center', marginVertical: 16 },
  cameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.bg },

  adBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.blue, borderRadius: 22, paddingVertical: 12, marginTop: 12 },
  adBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  field: { marginTop: 18 },
  fieldLabel: { fontSize: 14, color: C.muted, marginBottom: 8 },
  fieldHint: { fontSize: 12, color: C.muted, marginTop: 6 },
  textInput: { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.text },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 14 },
  prefix: { fontSize: 16, color: C.muted, marginRight: 6 },
  input: { flex: 1, paddingVertical: 12, fontSize: 16, color: C.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#14283A', borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12 },
  chipText: { fontSize: 13, color: C.blue, fontWeight: '600' },

  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 8, paddingBottom: 6, backgroundColor: C.bg },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabLabel: { fontSize: 11, color: C.muted },
});