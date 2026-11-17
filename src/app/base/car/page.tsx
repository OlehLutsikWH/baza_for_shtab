'use client';
// Статичний експорт: динамічні маршрути без generateStaticParams не працюють,
// тому ID авто передається параметром ?id=…
import { useSearchParams } from 'next/navigation';
import { VehicleDetailView } from '../../../components/base/VehicleDetailView';

export default function CarPage() {
  const params = useSearchParams();
  return <VehicleDetailView id={params.get('id')} initialTab={params.get('tab')} />;
}
