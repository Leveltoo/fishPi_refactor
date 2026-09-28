import { weatherIconUrl } from "../weatherIcons";
import type { WeatherCard as WeatherCardData } from "../messageView";

type WeatherCardProps = {
  card: WeatherCardData;
  fallback: string;
};

function dayHasDetail(day: WeatherCardData["days"][number]): boolean {
  return (
    day.date.length > 0 ||
    day.maxTemp.length > 0 ||
    day.minTemp.length > 0 ||
    day.code.length > 0
  );
}

export function WeatherCard({ card, fallback }: WeatherCardProps) {
  const days = card.days.filter(dayHasDetail);
  const area = card.area.trim();
  const summary = card.summary.trim();
  if (area.length === 0 && summary.length === 0 && days.length === 0) {
    return <p className="chat-msg-plain">{fallback}</p>;
  }

  return (
    <div className="chat-weather">
      {area.length > 0 ? <p className="chat-weather-area">{area}</p> : null}
      {summary.length > 0 ? <p className="chat-weather-summary">{summary}</p> : null}
      {days.length > 0 ? (
        <div className="chat-weather-days">
          {days.map((day, index) => {
            const icon = weatherIconUrl(day.code);
            return (
              <div className="chat-weather-day" key={`${day.date}-${day.code}-${index}`}>
                {day.date.length > 0 ? <p>{day.date}</p> : null}
                {day.maxTemp.length > 0 ? <p>最高温: {day.maxTemp}°C</p> : null}
                {day.minTemp.length > 0 ? <p>最低温: {day.minTemp}°C</p> : null}
                {icon ? (
                  <img src={icon} alt="" />
                ) : day.code.length > 0 ? (
                  <p>{day.code}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
