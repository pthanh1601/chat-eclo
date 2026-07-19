import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import qrcode from 'qrcode-generator';

export function MatrixQrCode({size = 224, value}: {size?: number; value: string}) {
  const matrix = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    return Array.from({length: count}, (_, row) => (
      Array.from({length: count}, (_item, column) => qr.isDark(row, column))
    ));
  }, [value]);
  const moduleCount = matrix.length || 1;
  const quietZone = 12;
  const cellSize = Math.max(1, Math.floor((size - quietZone * 2) / moduleCount));
  const codeSize = cellSize * moduleCount;

  return (
    <View style={[styles.frame, {width: codeSize + quietZone * 2, height: codeSize + quietZone * 2, padding: quietZone}]}>
      {matrix.map((row, rowIndex) => (
        <View key={`qr-row-${rowIndex}`} style={styles.row}>
          {row.map((dark, columnIndex) => (
            <View
              key={`qr-cell-${columnIndex}`}
              style={{width: cellSize, height: cellSize, backgroundColor: dark ? '#07111f' : '#fff'}}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {backgroundColor: '#fff', borderRadius: 22, overflow: 'hidden'},
  row: {flexDirection: 'row'},
});
