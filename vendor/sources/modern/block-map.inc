// Project extension to libjxl decode.cc. The upstream archive stays byte-identical.
// Only a full, untransformed VarDCT frame has block positions matching output pixels.
extern "C" size_t viewer_jxl_block_map(JxlDecoder* dec, uint32_t* owners,
                                        size_t capacity, uint32_t width,
                                        uint32_t height) {
  if (!dec || !owners || !dec->frame_header || !dec->passes_state || !width ||
      !height) return 0;
  const auto& frame = *dec->frame_header;
  if (frame.encoding != jxl::FrameEncoding::kVarDCT ||
      frame.frame_type != jxl::FrameType::kRegularFrame ||
      frame.custom_size_or_origin || frame.upsampling != 1 ||
      frame.default_xsize() != width || frame.default_ysize() != height)
    return 0;
  const size_t columns = (static_cast<size_t>(width) + 7) / 8;
  const size_t rows = (static_cast<size_t>(height) + 7) / 8;
  const size_t count = columns * rows;
  if (count > capacity || count > 625000 || !dec->passes_state->shared)
    return 0;
  const auto& strategies = dec->passes_state->shared->ac_strategy;
  if (strategies.xsize() < columns || strategies.ysize() < rows) return 0;
  std::fill(owners, owners + count, 0);
  for (size_t y = 0; y < rows; ++y) {
    const auto row = strategies.ConstRow(y);
    for (size_t x = 0; x < columns; ++x) {
      const auto strategy = row[x];
      if (!strategy.IsFirstBlock()) continue;
      const uint32_t owner = static_cast<uint32_t>(y * columns + x + 1);
      const size_t bottom = std::min(rows, y + strategy.covered_blocks_y());
      const size_t right = std::min(columns, x + strategy.covered_blocks_x());
      for (size_t yy = y; yy < bottom; ++yy)
        for (size_t xx = x; xx < right; ++xx) {
          auto& cell = owners[yy * columns + xx];
          if (cell) return 0;
          cell = owner;
        }
    }
  }
  for (size_t i = 0; i < count; ++i)
    if (!owners[i]) return 0;
  return count;
}
