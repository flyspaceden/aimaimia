import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CompanyEvent } from '../../types';
import { useTheme } from '../../theme';

type CalendarStripProps = {
  events: CompanyEvent[];
  selectedDate?: string;
  days?: number;
  startDate?: Date;
  onSelectDate?: (date: string) => void;
};

const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
const formatDate = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (base: Date, days: number) => {
  const next = new Date(base);
  next.setDate(base.getDate() + days);
  return next;
};

// 日历条：未来窗口日期选择（显示事件数量，支持横向滑动）
export const CalendarStrip = ({
  events,
  selectedDate,
  days = 7,
  startDate = new Date(),
  onSelectDate,
}: CalendarStripProps) => {
  const { colors, radius, spacing, typography } = useTheme();
  const normalizedStart = useMemo(() => {
    const value = new Date(startDate);
    value.setHours(0, 0, 0, 0);
    return value;
  }, [startDate]);

  const dayList = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(normalizedStart, index)),
    [days, normalizedStart]
  );

  const eventCountByDate = useMemo(() => {
    const map = new Map<string, number>();
    events.forEach((event) => {
      map.set(event.date, (map.get(event.date) ?? 0) + 1);
    });
    return map;
  }, [events]);

  const todayKey = formatDate(new Date());

  return (
    <View style={styles.row}>
      {dayList.map((date) => {
        const dateKey = formatDate(date);
        const active = dateKey === selectedDate;
        const isToday = dateKey === todayKey;
        const count = eventCountByDate.get(dateKey) ?? 0;
        return (
          <Pressable
            key={dateKey}
            onPress={() => onSelectDate?.(dateKey)}
            style={[
              styles.card,
              {
                borderRadius: radius.md,
                backgroundColor: active ? colors.brand.primary : colors.surface,
                borderColor: active ? colors.brand.primary : isToday ? colors.accent.blue : colors.border,
                marginRight: spacing.sm,
              },
            ]}
          >
            <Text style={[typography.caption, { color: active ? colors.text.inverse : colors.text.secondary }]}>
              周{weekLabels[date.getDay()]}
            </Text>
            <Text
              style={[
                typography.title3,
                { color: active ? colors.text.inverse : colors.text.primary, marginTop: 4 },
              ]}
            >
              {date.getDate()}
            </Text>
            {count > 0 ? (
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: active ? colors.surface : colors.brand.primarySoft,
                    borderRadius: radius.pill,
                  },
                ]}
              >
                <Text style={[typography.caption, { color: colors.brand.primary }]}>{count}</Text>
              </View>
            ) : (
              <View style={[styles.dot, { backgroundColor: active ? colors.surface : colors.border }]} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
  },
  card: {
    width: 68,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  badge: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  dot: {
    marginTop: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
