package handlers

import (
	"errors"
	"log"
	"strconv"
	"strings"
	"time"
)

type weeklyScheduleWindow struct {
	days        [7]bool
	startMinute int
	endMinute   int
}

func parseBriefingSchedule(timezone, rawWindows string) (*time.Location, []weeklyScheduleWindow) {
	rawWindows = strings.TrimSpace(rawWindows)
	if rawWindows == "" {
		return time.UTC, nil
	}

	timezone = strings.TrimSpace(timezone)
	if timezone == "" {
		timezone = "Asia/Shanghai"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		log.Printf("auto ai briefing schedule disabled: invalid timezone %q: %v", timezone, err)
		return time.UTC, []weeklyScheduleWindow{allWeekScheduleWindow()}
	}

	windows, err := parseWeeklyScheduleWindows(rawWindows)
	if err != nil {
		log.Printf("auto ai briefing schedule disabled: invalid blocked windows %q: %v", rawWindows, err)
		return location, []weeklyScheduleWindow{allWeekScheduleWindow()}
	}
	return location, windows
}

func parseWeeklyScheduleWindows(raw string) ([]weeklyScheduleWindow, error) {
	parts := strings.Split(raw, ",")
	windows := make([]weeklyScheduleWindow, 0, len(parts))
	for _, part := range parts {
		dayPart, timePart, ok := strings.Cut(strings.TrimSpace(part), "@")
		if !ok || strings.TrimSpace(dayPart) == "" {
			return nil, errors.New("window must use DAYS@HH:MM-HH:MM")
		}
		days, err := parseScheduleDays(dayPart)
		if err != nil {
			return nil, err
		}
		startRaw, endRaw, ok := strings.Cut(timePart, "-")
		if !ok {
			return nil, errors.New("window must include a start and end time")
		}
		startMinute, err := parseScheduleMinute(startRaw, false)
		if err != nil {
			return nil, err
		}
		endMinute, err := parseScheduleMinute(endRaw, true)
		if err != nil {
			return nil, err
		}
		if startMinute >= endMinute {
			return nil, errors.New("window end must be later than start; split overnight windows at midnight")
		}
		windows = append(windows, weeklyScheduleWindow{days: days, startMinute: startMinute, endMinute: endMinute})
	}
	return windows, nil
}

func parseScheduleDays(raw string) ([7]bool, error) {
	var days [7]bool
	dayNames := []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	dayIndex := func(value string) int {
		value = strings.ToLower(strings.TrimSpace(value))
		for index, name := range dayNames {
			if value == name {
				return index
			}
		}
		return -1
	}

	raw = strings.TrimSpace(raw)
	if raw == "*" {
		for index := range days {
			days[index] = true
		}
		return days, nil
	}
	startRaw, endRaw, hasRange := strings.Cut(raw, "-")
	start := dayIndex(startRaw)
	if start < 0 {
		return days, errors.New("invalid schedule weekday")
	}
	if !hasRange {
		days[start] = true
		return days, nil
	}
	end := dayIndex(endRaw)
	if end < 0 {
		return days, errors.New("invalid schedule weekday range")
	}
	for index := start; ; index = (index + 1) % len(days) {
		days[index] = true
		if index == end {
			break
		}
	}
	return days, nil
}

func parseScheduleMinute(raw string, allowEndOfDay bool) (int, error) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) != 2 {
		return 0, errors.New("schedule time must use HH:MM")
	}
	hour, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, errors.New("invalid schedule hour")
	}
	minute, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, errors.New("invalid schedule minute")
	}
	if allowEndOfDay && hour == 24 && minute == 0 {
		return 24 * 60, nil
	}
	if hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, errors.New("schedule time is outside 00:00-23:59")
	}
	return hour*60 + minute, nil
}

func allWeekScheduleWindow() weeklyScheduleWindow {
	var days [7]bool
	for index := range days {
		days[index] = true
	}
	return weeklyScheduleWindow{days: days, startMinute: 0, endMinute: 24 * 60}
}

func briefingScheduleBlocked(now time.Time, location *time.Location, windows []weeklyScheduleWindow) bool {
	if len(windows) == 0 {
		return false
	}
	if location == nil {
		location = time.UTC
	}
	localNow := now.In(location)
	minute := localNow.Hour()*60 + localNow.Minute()
	for _, window := range windows {
		if window.days[int(localNow.Weekday())] && minute >= window.startMinute && minute < window.endMinute {
			return true
		}
	}
	return false
}
